import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { readFile, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";
import neo4j from "neo4j-driver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const suite = process.argv[2];

if (!suite || !["sync", "admin"].includes(suite)) {
  throw new Error("Usage: node scripts/api/run-postman-suite.mjs <sync|admin> [environmentPath]");
}

const environmentPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(repoRoot, "api-tests", "environment.local.json");
const collectionPath = path.join(repoRoot, "api-tests", `${suite}.json`);
const exportEnvironmentPath = path.join(
  os.tmpdir(),
  `moviematch-postman-${suite}-${Date.now()}.json`,
);
const newmanCliPath = path.join(repoRoot, "node_modules", "newman", "bin", "newman.js");

await runNewman();
const environmentValues = await readExportedEnvironment();
await validateBackendState(environmentValues);
await rm(exportEnvironmentPath, { force: true });

async function runNewman() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        newmanCliPath,
        "run",
        collectionPath,
        "-e",
        environmentPath,
        "--export-environment",
        exportEnvironmentPath,
        "--color",
        "on",
      ],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Newman exited with code ${code}.`));
    });

    child.on("error", reject);
  });
}

async function readExportedEnvironment() {
  const raw = await readFile(exportEnvironmentPath, "utf8");
  const parsed = JSON.parse(raw);
  return Object.fromEntries(parsed.values.map((entry) => [entry.key, entry.value]));
}

async function validateBackendState(values) {
  const dbConfig = await resolveDbConfig();
  if (!dbConfig) {
    console.warn("Skipping Mongo/Neo4j validation: DB config is not set. Export MONGO_URI and NEO4J_* if you want strict backend validation.");
    return;
  }

  const {
    mongoUri,
    neo4jUri,
    neo4jUser,
    neo4jPassword,
  } = dbConfig;

  const mongoClient = new MongoClient(mongoUri);
  const neo4jDriver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
  );

  try {
    await mongoClient.connect();
    const db = mongoClient.db();
    const neo4jSession = neo4jDriver.session();

    try {
      if (suite === "sync") {
        await validateSyncSuite(db, neo4jSession, values);
      } else {
        await validateAdminSuite(db, neo4jSession, values);
      }
    } finally {
      await neo4jSession.close();
    }
  } finally {
    await Promise.allSettled([
      mongoClient.close(),
      neo4jDriver.close(),
    ]);
  }
}

async function validateSyncSuite(db, neo4jSession, values) {
  const userId = requireValue(values, "syncUserId");
  const movieId = requireValue(values, "syncMovieId");

  const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error(`Mongo validation failed: user ${userId} was not found.`);
  }

  const likedMovieIds = (user.likedMovies || []).map((id) => id.toString());
  if (likedMovieIds.includes(movieId)) {
    throw new Error(`Mongo validation failed: movie ${movieId} is still present in likedMovies for user ${userId} after unlike.`);
  }

  const likeInteraction = await db.collection("interactions").findOne({
    userId: new ObjectId(userId),
    movieId: new ObjectId(movieId),
    type: "like",
  });

  if (!likeInteraction) {
    throw new Error(`Mongo validation failed: no like interaction for user ${userId} and movie ${movieId}.`);
  }

  const unlikeInteraction = await db.collection("interactions").findOne({
    userId: new ObjectId(userId),
    movieId: new ObjectId(movieId),
    type: "unlike",
  });

  if (!unlikeInteraction) {
    throw new Error(`Mongo validation failed: no unlike interaction for user ${userId} and movie ${movieId}.`);
  }

  const neo4jResult = await neo4jSession.run(
    `
    MATCH (u:User {id: $userId})-[r:LIKED]->(m:Movie {id: $movieId})
    RETURN COUNT(r) AS relationCount
    `,
    { userId, movieId },
  );

  const relationCount = readNeo4jCount(neo4jResult.records[0]?.get("relationCount"));
  if (relationCount !== 0) {
    throw new Error(`Neo4j validation failed: LIKED relation still exists for user ${userId} and movie ${movieId} after unlike.`);
  }

  console.log(`Backend validation passed for sync suite: like/unlike was synchronized and cleanup removed movie ${movieId} for user ${userId}.`);
}

async function validateAdminSuite(db, neo4jSession, values) {
  const createdMovieId = requireValue(values, "createdMovieId");
  const adminMovieTitle = requireValue(values, "adminMovieTitle");

  const movie = await db.collection("movies").findOne({ _id: new ObjectId(createdMovieId) });
  if (movie) {
    if (movie.title !== adminMovieTitle) {
      throw new Error(`Mongo validation failed: expected title "${adminMovieTitle}", got "${movie.title}".`);
    }

    const neo4jResult = await neo4jSession.run(
      `
      MATCH (m:Movie {id: $movieId})
      OPTIONAL MATCH (m)-[:HAS_TAG]->(t:Tag)
      RETURN COUNT(m) AS movieCount, COUNT(t) AS tagCount
      `,
      { movieId: createdMovieId },
    );

    const record = neo4jResult.records[0];
    const movieCount = readNeo4jCount(record?.get("movieCount"));
    const tagCount = readNeo4jCount(record?.get("tagCount"));

    if (movieCount < 1) {
      throw new Error(`Neo4j validation failed: movie node ${createdMovieId} was not created.`);
    }

    if (tagCount < 1) {
      throw new Error(`Neo4j validation failed: movie node ${createdMovieId} has no HAS_TAG relations.`);
    }

    console.log(`Backend validation passed for admin suite: movie ${createdMovieId} exists in Mongo and Neo4j before cleanup.`);
    return;
  }

  const neo4jResult = await neo4jSession.run(
    `
    MATCH (m:Movie {id: $movieId})
    RETURN COUNT(m) AS movieCount
    `,
    { movieId: createdMovieId },
  );

  const movieCount = readNeo4jCount(neo4jResult.records[0]?.get("movieCount"));
  if (movieCount > 0) {
    throw new Error(`Mongo validation failed: movie ${createdMovieId} is absent in Mongo but still exists in Neo4j.`);
  }

  console.log(`Backend validation passed for admin suite: cleanup removed movie ${createdMovieId} from Mongo and Neo4j.`);
}

function requireValue(values, key) {
  const value = values[key];
  if (!value) {
    throw new Error(`Expected Postman environment value "${key}" to be set.`);
  }

  return value;
}

function readNeo4jCount(value) {
  if (typeof value?.toNumber === "function") {
    return value.toNumber();
  }

  if (typeof value?.low === "number") {
    return value.low;
  }

  return Number(value || 0);
}

async function resolveDbConfig() {
  if (process.env.MONGO_URI && process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    return {
      mongoUri: process.env.MONGO_URI,
      neo4jUri: process.env.NEO4J_URI,
      neo4jUser: process.env.NEO4J_USER,
      neo4jPassword: process.env.NEO4J_PASSWORD,
    };
  }

  const appDir = process.env.MOVIE_MATCH_APP_DIR;
  if (!appDir) {
    return null;
  }

  const backendEnvPath = path.join(appDir, "backend", ".env");
  try {
    await access(backendEnvPath);
  } catch {
    return null;
  }

  const raw = await readFile(backendEnvPath, "utf8");
  const parsed = parseDotenv(raw);

  if (!parsed.MONGO_URI || !parsed.NEO4J_URI || !parsed.NEO4J_USER || !parsed.NEO4J_PASSWORD) {
    return null;
  }

  return {
    mongoUri: parsed.MONGO_URI,
    neo4jUri: parsed.NEO4J_URI,
    neo4jUser: parsed.NEO4J_USER,
    neo4jPassword: parsed.NEO4J_PASSWORD,
  };
}

function parseDotenv(raw) {
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

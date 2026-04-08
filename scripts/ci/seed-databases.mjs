import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import neo4j from "neo4j-driver";

const mongoUri = process.env.MONGO_URI;
const neo4jUri = process.env.NEO4J_URI;
const neo4jUser = process.env.NEO4J_USER;
const neo4jPassword = process.env.NEO4J_PASSWORD;

if (!mongoUri || !neo4jUri || !neo4jUser || !neo4jPassword) {
  throw new Error("MONGO_URI, NEO4J_URI, NEO4J_USER and NEO4J_PASSWORD must be set.");
}

const steveId = new ObjectId("660000000000000000000001");
const amyId = new ObjectId("660000000000000000000002");

const movieIds = {
  matrix: new ObjectId("660000000000000000000101"),
  signal: new ObjectId("660000000000000000000102"),
  odyssey: new ObjectId("660000000000000000000103"),
  romance: new ObjectId("660000000000000000000104"),
  detective: new ObjectId("660000000000000000000105"),
};

const movies = [
  {
    _id: movieIds.matrix,
    title: "Matrix Echo",
    year: 1999,
    description: "Hackers discover a synthetic reality.",
    genre: ["Sci-Fi", "Action"],
    tags: ["cyberpunk", "ai", "action"],
    bannerUrl: "https://example.com/matrix-echo.jpg",
  },
  {
    _id: movieIds.signal,
    title: "Signal Drift",
    year: 2003,
    description: "A rogue AI spreads through orbital networks.",
    genre: ["Sci-Fi", "Thriller"],
    tags: ["ai", "space", "thriller"],
    bannerUrl: "https://example.com/signal-drift.jpg",
  },
  {
    _id: movieIds.odyssey,
    title: "Odyssey Run",
    year: 2010,
    description: "Explorers race across a failing colony route.",
    genre: ["Sci-Fi", "Adventure"],
    tags: ["space", "adventure", "future"],
    bannerUrl: "https://example.com/odyssey-run.jpg",
  },
  {
    _id: movieIds.romance,
    title: "Paris Blue",
    year: 2008,
    description: "A quiet romance under impossible timing.",
    genre: ["Romance", "Drama"],
    tags: ["romance", "drama", "city"],
    bannerUrl: "https://example.com/paris-blue.jpg",
  },
  {
    _id: movieIds.detective,
    title: "Night Signal",
    year: 2014,
    description: "A detective hunts a pirate broadcaster.",
    genre: ["Mystery", "Crime"],
    tags: ["crime", "mystery", "signal"],
    bannerUrl: "https://example.com/night-signal.jpg",
  },
];

const hashedPassword = await bcrypt.hash("123", 10);

const users = [
  {
    _id: steveId,
    username: "steve",
    email: "steve@example.com",
    password: hashedPassword,
    role: "admin",
    likedMovies: [movieIds.matrix],
  },
  {
    _id: amyId,
    username: "amy",
    email: "amy@example.com",
    password: hashedPassword,
    role: "user",
    likedMovies: [movieIds.matrix, movieIds.signal, movieIds.odyssey],
  },
];

const interactions = [
  {
    _id: new ObjectId("660000000000000000000201"),
    userId: steveId,
    movieId: movieIds.matrix,
    type: "like",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    _id: new ObjectId("660000000000000000000202"),
    userId: amyId,
    movieId: movieIds.matrix,
    type: "like",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  {
    _id: new ObjectId("660000000000000000000203"),
    userId: amyId,
    movieId: movieIds.signal,
    type: "like",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    _id: new ObjectId("660000000000000000000204"),
    userId: amyId,
    movieId: movieIds.odyssey,
    type: "like",
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
  },
];

const mongoClient = new MongoClient(mongoUri);
const neo4jDriver = neo4j.driver(
  neo4jUri,
  neo4j.auth.basic(neo4jUser, neo4jPassword),
);

try {
  await mongoClient.connect();
  const db = mongoClient.db();

  await Promise.all([
    db.collection("users").deleteMany({}),
    db.collection("movies").deleteMany({}),
    db.collection("interactions").deleteMany({}),
  ]);

  await db.collection("movies").insertMany(movies);
  await db.collection("users").insertMany(users);
  await db.collection("interactions").insertMany(interactions);

  const session = neo4jDriver.session();

  try {
    await session.run("MATCH (n) DETACH DELETE n");

    for (const user of users) {
      await session.run(
        "CREATE (:User {id: $id, username: $username})",
        { id: user._id.toString(), username: user.username },
      );
    }

    for (const movie of movies) {
      await session.run(
        "CREATE (:Movie {id: $id, title: $title, year: $year})",
        { id: movie._id.toString(), title: movie.title, year: movie.year },
      );

      for (const tag of movie.tags) {
        await session.run(
          `
          MATCH (m:Movie {id: $movieId})
          MERGE (t:Tag {name: $tag})
          MERGE (m)-[:HAS_TAG]->(t)
          `,
          { movieId: movie._id.toString(), tag },
        );
      }
    }

    const likedRelations = [
      [steveId, movieIds.matrix],
      [amyId, movieIds.matrix],
      [amyId, movieIds.signal],
      [amyId, movieIds.odyssey],
    ];

    for (const [userId, movieId] of likedRelations) {
      await session.run(
        `
        MATCH (u:User {id: $userId})
        MATCH (m:Movie {id: $movieId})
        MERGE (u)-[:LIKED]->(m)
        `,
        { userId: userId.toString(), movieId: movieId.toString() },
      );
    }
  } finally {
    await session.close();
  }

  console.log("Seeded MongoDB and Neo4j with deterministic CI data.");
} finally {
  await Promise.allSettled([
    mongoClient.close(),
    neo4jDriver.close(),
  ]);
}

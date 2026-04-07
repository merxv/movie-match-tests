import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const appDir = process.argv[2] || process.env.MOVIE_MATCH_APP_DIR;

if (!appDir) {
  throw new Error("Application directory is required as argv[2] or MOVIE_MATCH_APP_DIR.");
}

const backendDir = path.join(appDir, "backend");
const frontendDir = path.join(appDir, "frontend");

const backendEnv = [
  `PORT=${process.env.APP_BACKEND_PORT || "4000"}`,
  `MONGO_URI=${process.env.MONGO_URI || "mongodb://127.0.0.1:27017/moviematch_ci"}`,
  `NEO4J_URI=${process.env.NEO4J_URI || "bolt://127.0.0.1:7687"}`,
  `NEO4J_USER=${process.env.NEO4J_USER || "neo4j"}`,
  `NEO4J_PASSWORD=${process.env.NEO4J_PASSWORD || "password"}`,
  `JWT_SECRET=${process.env.JWT_SECRET || "ci-jwt-secret"}`,
  `TMDB_ACCESS_TOKEN=${process.env.TMDB_ACCESS_TOKEN || ""}`,
  "",
].join("\n");

const frontendEnv = [
  `VITE_API_URL=${process.env.VITE_API_URL || "http://127.0.0.1:4000"}`,
  "",
].join("\n");

await mkdir(backendDir, { recursive: true });
await mkdir(frontendDir, { recursive: true });

await writeFile(path.join(backendDir, ".env"), backendEnv, "utf8");
await writeFile(path.join(frontendDir, ".env"), frontendEnv, "utf8");

console.log(`Wrote CI env files into ${appDir}`);

import path from "node:path";

const appDir = process.env.MOVIE_MATCH_APP_DIR
  || "C:\\Users\\legionnaire\\Desktop\\study\\1 trimester\\базы данных\\ass6ver2";
const backendDir = path.join(appDir, "backend");

function target(relativePath) {
  return path.join(backendDir, relativePath);
}

export const chaosConfig = {
  appDir,
  backendDir,
  baseUrl: process.env.CHAOS_BASE_URL || "http://127.0.0.1:4000",
  probeIntervalMs: Number(process.env.CHAOS_PROBE_INTERVAL_MS || 1000),
  requestTimeoutMs: Number(process.env.CHAOS_REQUEST_TIMEOUT_MS || 5000),
  loginEmail: process.env.CHAOS_LOGIN_EMAIL || "steve@example.com",
  loginPassword: process.env.CHAOS_LOGIN_PASSWORD || "123",
};

export const chaosScenarios = [
  {
    id: "API-DOWN-01",
    module: "API Availability / All Routes",
    faultType: "API downtime",
    durationMs: 8000,
    preFaultMs: 4000,
    postFaultMs: 6000,
    description: "Stop the backend process for 8 seconds, then restart it and observe end-user impact.",
    injection: { type: "backend-stop-start" },
  },
  {
    id: "MONGO-SLOW-01",
    module: "Movie Catalog / MongoDB Read Path",
    faultType: "Database slow response",
    durationMs: 10000,
    preFaultMs: 4000,
    postFaultMs: 6000,
    description: "Inject a 2.5 second delay into the movie catalog read path to simulate a slow MongoDB response.",
    injection: {
      type: "patch-cycle",
      file: target("src\\controllers\\movieController.js"),
      search: "    const movies = await Movie.find();",
      replace: "    await new Promise((resolve) => setTimeout(resolve, 2500));\n    const movies = await Movie.find();",
    },
  },
  {
    id: "NEO4J-FAIL-01",
    module: "Recommendation Engine / Neo4j",
    faultType: "Database failure",
    durationMs: 10000,
    preFaultMs: 4000,
    postFaultMs: 6000,
    description: "Inject a recommendation-path failure to simulate Neo4j becoming unavailable.",
    injection: {
      type: "patch-cycle",
      file: target("src\\controllers\\recommendController.js"),
      search: "    const session = driver.session();",
      replace: "    return res.status(503).json({ error: \"Neo4j temporarily unavailable\" });\n    const session = driver.session();",
    },
  },
  {
    id: "NET-LATENCY-01",
    module: "API Gateway / Network Path",
    faultType: "Network latency",
    durationMs: 10000,
    preFaultMs: 4000,
    postFaultMs: 6000,
    description: "Inject a 1.2 second middleware delay on all API requests to emulate network latency and slow transit.",
    injection: {
      type: "patch-cycle",
      file: target("src\\app.js"),
      search: "app.use(morgan('dev'));",
      replace: "app.use(morgan('dev'));\napp.use(async (req, res, next) => {\n  await new Promise((resolve) => setTimeout(resolve, 1200));\n  next();\n});",
    },
  },
  {
    id: "CPU-STRESS-01",
    module: "Authentication / Node.js Runtime",
    faultType: "Resource exhaustion",
    durationMs: 12000,
    preFaultMs: 4000,
    postFaultMs: 6000,
    description: "Spawn CPU hog workers during login and profile traffic to observe service degradation under compute pressure.",
    injection: {
      type: "cpu-hog",
      workerCount: Number(process.env.CHAOS_CPU_HOG_WORKERS || 2),
    },
  },
];

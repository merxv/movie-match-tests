import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendFile,
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import { mutationConfig, mutants } from "../config/mutants.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const resultsDir = path.join(repoRoot, "mutation", "results");
const logsDir = path.join(resultsDir, "logs");
const rawReportPath = path.join(resultsDir, "latest-run.json");

await mkdir(logsDir, { recursive: true });

const startedAt = new Date();
const backendEnvPath = path.join(mutationConfig.backendDir, ".env");

await prepareApp();

const originalFiles = new Map();
for (const mutant of mutants) {
  if (!originalFiles.has(mutant.file)) {
    originalFiles.set(mutant.file, await readFile(mutant.file, "utf8"));
  }
}

const baseline = await executeScenario({
  id: "baseline",
  label: "baseline",
  description: "Original application without mutations.",
});

if (baseline.status !== "passed") {
  const failedReport = buildReport({
    startedAt,
    finishedAt: new Date(),
    baseline,
    mutants: [],
  });
  await writeFile(rawReportPath, JSON.stringify(failedReport, null, 2), "utf8");
  await runNodeScript(path.join(repoRoot, "mutation", "scripts", "render-summary.mjs"), []);
  throw new Error(`Baseline failed. Inspect ${baseline.logPath} before running mutation testing.`);
}

const mutantResults = [];

for (const mutant of mutants) {
  const originalSource = originalFiles.get(mutant.file);
  if (!originalSource) {
    throw new Error(`Original source for ${mutant.file} was not cached.`);
  }

  const mutatedSource = applyMutation(originalSource, mutant);
  await writeFile(mutant.file, mutatedSource, "utf8");

  try {
    const result = await executeScenario({
      id: mutant.id,
      label: mutant.id,
      description: mutant.description,
      mutant,
    });
    mutantResults.push(result);
  } finally {
    await writeFile(mutant.file, originalSource, "utf8");
  }
}

const report = buildReport({
  startedAt,
  finishedAt: new Date(),
  baseline,
  mutants: mutantResults,
});

await writeFile(rawReportPath, JSON.stringify(report, null, 2), "utf8");
await runNodeScript(path.join(repoRoot, "mutation", "scripts", "render-summary.mjs"), []);

console.log(`Mutation testing complete. Raw report: ${rawReportPath}`);

async function prepareApp() {
  const shouldWriteEnv = process.env.MUTATION_WRITE_ENV === "1";

  if (shouldWriteEnv) {
    await runNodeScript(path.join(repoRoot, "scripts", "ci", "write-env.mjs"), [mutationConfig.appDir]);
    return;
  }

  try {
    await access(backendEnvPath);
  } catch {
    await runNodeScript(path.join(repoRoot, "scripts", "ci", "write-env.mjs"), [mutationConfig.appDir]);
  }
}

function applyMutation(source, mutant) {
  const matches = source.split(mutant.search).length - 1;
  if (matches !== 1) {
    throw new Error(`Mutation ${mutant.id} expected exactly one match in ${mutant.file}, found ${matches}.`);
  }

  return source.replace(mutant.search, mutant.replace);
}

async function executeScenario({ id, label, description, mutant }) {
  const logPath = path.join(logsDir, `${label}.log`);
  const started = Date.now();
  const env = await buildChildEnv();
  let backendProcess;

  await writeFile(
    logPath,
    [
      `# ${label}`,
      `startedAt=${new Date().toISOString()}`,
      `description=${description}`,
      mutant ? `module=${mutant.module}` : "module=baseline",
      mutant ? `mutantType=${mutant.mutantType}` : "mutantType=baseline",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    backendProcess = spawn(process.execPath, ["src/app.js"], {
      cwd: mutationConfig.backendDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    pipeProcessOutput(backendProcess, logPath, "[backend]");

    await waitForHttp(`${mutationConfig.baseUrl}/api/movies`, 30000);
    await appendLog(logPath, "\n[runner] backend became ready\n");

    await runNodeScript(path.join(repoRoot, "scripts", "ci", "seed-databases.mjs"), [], { env, logPath, prefix: "[seed]" });
    await runNodeScript(path.join(repoRoot, "scripts", "api", "run-postman-suite.mjs"), ["sync"], { env, logPath, prefix: "[sync]" });
    await runNodeScript(path.join(repoRoot, "scripts", "api", "run-postman-suite.mjs"), ["admin"], { env, logPath, prefix: "[admin]" });

    const durationMs = Date.now() - started;
    await appendLog(logPath, `\n[runner] suite passed in ${durationMs} ms\n`);

    return {
      id,
      status: "passed",
      durationMs,
      logPath,
      ...(mutant ? serializeMutant(mutant) : {}),
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    await appendLog(logPath, `\n[runner] suite failed in ${durationMs} ms\n[runner] error=${message}\n`);

    return {
      id,
      status: mutant ? "killed" : "failed",
      durationMs,
      logPath,
      failureReason: message,
      ...(mutant ? serializeMutant(mutant) : {}),
    };
  } finally {
    if (backendProcess) {
      await stopProcess(backendProcess, logPath);
    }
    await rm(path.join(mutationConfig.backendDir, "backend.log"), { force: true }).catch(() => {});
  }
}

function serializeMutant(mutant) {
  return {
    module: mutant.module,
    mutantType: mutant.mutantType,
    file: mutant.file,
    description: mutant.description,
  };
}

async function buildChildEnv() {
  const parsedEnv = parseDotenv(await readFile(backendEnvPath, "utf8"));
  return {
    ...process.env,
    ...parsedEnv,
    MOVIE_MATCH_APP_DIR: mutationConfig.appDir,
  };
}

function parseDotenv(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    result[key] = value;
  }

  return result;
}

function pipeProcessOutput(child, logPath, prefix) {
  for (const [streamName, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream?.on("data", (chunk) => {
      appendLog(logPath, `${prefix}[${streamName}] ${chunk}`).catch(() => {});
    });
  }
}

async function runNodeScript(scriptPath, args, options = {}) {
  const { env = process.env, logPath, prefix = "[node]" } = options;
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (logPath) {
    pipeProcessOutput(child, logPath, prefix);
  }

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(scriptPath)} exited with code ${code}.`));
    });
    child.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function stopProcess(child, logPath) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");

  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!closed && child.exitCode === null) {
    child.kill("SIGTERM");
  }

  await appendLog(logPath, "[runner] backend process stopped\n");
}

async function appendLog(logPath, text) {
  await appendFile(logPath, text, "utf8");
}

function buildReport({ startedAt, finishedAt, baseline, mutants: mutantRuns }) {
  const killed = mutantRuns.filter((entry) => entry.status === "killed").length;
  const survived = mutantRuns.filter((entry) => entry.status === "passed").length;

  return {
    generatedAt: finishedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    appDir: mutationConfig.appDir,
    baseUrl: mutationConfig.baseUrl,
    suiteName: mutationConfig.suiteName,
    baseline,
    mutants: mutantRuns.map((entry) => ({
      ...entry,
      status: entry.status === "passed" ? "survived" : entry.status,
    })),
    totals: {
      created: mutantRuns.length,
      killed,
      survived,
      mutationScore: mutantRuns.length === 0 ? 0 : Number(((killed / mutantRuns.length) * 100).toFixed(2)),
    },
  };
}

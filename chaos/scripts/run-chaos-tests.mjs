import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import { chaosConfig, chaosScenarios } from "../config/scenarios.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const resultsDir = path.join(repoRoot, "chaos", "results");
const logsDir = path.join(resultsDir, "logs");
const reportPath = path.join(resultsDir, "latest-run.json");
const backendEnvPath = path.join(chaosConfig.backendDir, ".env");
const originalFiles = new Map();

await mkdir(logsDir, { recursive: true });
await prepareApp();

const startedAt = new Date();
const scenarioResults = [];

for (const scenario of chaosScenarios) {
  scenarioResults.push(await runScenario(scenario));
}

const report = buildReport(startedAt, new Date(), scenarioResults);
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
await runNodeScript(path.join(repoRoot, "chaos", "scripts", "render-summary.mjs"), []);

console.log(`Chaos testing complete. Raw report: ${reportPath}`);

async function prepareApp() {
  const shouldWriteEnv = process.env.CHAOS_WRITE_ENV === "1";

  if (shouldWriteEnv) {
    await runNodeScript(path.join(repoRoot, "scripts", "ci", "write-env.mjs"), [chaosConfig.appDir]);
    return;
  }

  try {
    await access(backendEnvPath);
  } catch {
    await runNodeScript(path.join(repoRoot, "scripts", "ci", "write-env.mjs"), [chaosConfig.appDir]);
  }
}

async function runScenario(scenario) {
  const logPath = path.join(logsDir, `${scenario.id}.log`);
  const timeline = [];
  const samples = [];
  const cycles = [];
  const startedMs = Date.now();
  const control = {
    phase: "startup",
    running: true,
    backendProcess: null,
    activeFaultProcess: null,
    faultInjectedAt: null,
    faultClearedAt: null,
    readinessError: null,
  };

  await writeFile(
    logPath,
    [
      `# ${scenario.id}`,
      `description=${scenario.description}`,
      `module=${scenario.module}`,
      `faultType=${scenario.faultType}`,
      `durationMs=${scenario.durationMs}`,
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    control.backendProcess = await startBackend(logPath);
    timeline.push(mark("backend_started"));

    await waitForHttp(`${chaosConfig.baseUrl}/api/movies`, 30000);
    timeline.push(mark("backend_ready"));

    await runNodeScript(path.join(repoRoot, "scripts", "ci", "seed-databases.mjs"), [], { env: await buildChildEnv(), logPath, prefix: "[seed]" });
    timeline.push(mark("seed_completed"));

    control.phase = "pre-fault";
    const probePromise = runProbeLoop({ scenario, control, samples, cycles, logPath });

    await sleep(scenario.preFaultMs);

    control.phase = "fault";
    control.faultInjectedAt = Date.now();
    timeline.push(mark("fault_injected"));

    await injectFault(scenario, control, logPath, timeline);

    control.phase = "post-fault";
    control.faultClearedAt = Date.now();
    timeline.push(mark("fault_cleared"));

    await sleep(scenario.postFaultMs);
    control.running = false;
    await probePromise;

    const metrics = analyzeScenario({ scenario, samples, cycles, control, timeline });
    await appendLog(logPath, `\n[runner] scenario completed\n`);

    return {
      id: scenario.id,
      module: scenario.module,
      faultType: scenario.faultType,
      description: scenario.description,
      durationMs: scenario.durationMs,
      logPath,
      timeline,
      metrics,
      sampleCount: samples.length,
      cycleCount: cycles.length,
      status: "completed",
    };
  } catch (error) {
    control.running = false;
    const message = error instanceof Error ? error.message : String(error);
    await appendLog(logPath, `\n[runner] scenario failed: ${message}\n`);

    return {
      id: scenario.id,
      module: scenario.module,
      faultType: scenario.faultType,
      description: scenario.description,
      durationMs: scenario.durationMs,
      logPath,
      timeline,
      metrics: analyzeScenario({ scenario, samples, cycles, control, timeline }),
      sampleCount: samples.length,
      cycleCount: cycles.length,
      status: "failed",
      failureReason: message,
    };
  } finally {
    await cleanupFault(scenario, control, logPath);
    if (control.backendProcess) {
      await stopProcess(control.backendProcess, logPath);
    }
    await appendLog(logPath, `[runner] scenario wall time ${Date.now() - startedMs} ms\n`);
  }
}

async function injectFault(scenario, control, logPath, timeline) {
  const injection = scenario.injection;

  if (injection.type === "backend-stop-start") {
    if (control.backendProcess) {
      await stopProcess(control.backendProcess, logPath);
      control.backendProcess = null;
      timeline.push(mark("backend_stopped_for_fault"));
    }

    await sleep(scenario.durationMs);

    control.backendProcess = await startBackend(logPath);
    timeline.push(mark("backend_restarted"));
    await waitForHttp(`${chaosConfig.baseUrl}/api/movies`, 30000);
    timeline.push(mark("backend_ready_after_restart"));
    return;
  }

  if (injection.type === "patch-cycle") {
    const original = await getOriginalSource(injection.file);
    const mutated = applyTextPatch(original, injection.search, injection.replace, scenario.id);

    if (control.backendProcess) {
      await stopProcess(control.backendProcess, logPath);
      control.backendProcess = null;
      timeline.push(mark("backend_stopped_for_patch"));
    }

    await writeFile(injection.file, mutated, "utf8");
    timeline.push(mark("fault_patch_applied"));

    control.backendProcess = await startBackend(logPath);
    timeline.push(mark("backend_restarted_with_fault"));
    await waitForHttp(`${chaosConfig.baseUrl}/api/movies`, 30000);
    timeline.push(mark("fault_ready"));

    await sleep(scenario.durationMs);

    await stopProcess(control.backendProcess, logPath);
    control.backendProcess = null;
    timeline.push(mark("backend_stopped_for_restore"));

    await writeFile(injection.file, original, "utf8");
    timeline.push(mark("fault_patch_restored"));

    control.backendProcess = await startBackend(logPath);
    timeline.push(mark("backend_restarted_after_restore"));
    await waitForHttp(`${chaosConfig.baseUrl}/api/movies`, 30000);
    timeline.push(mark("backend_ready_after_restore"));
    return;
  }

  if (injection.type === "cpu-hog") {
    const workerCount = injection.workerCount || 1;
    const workers = [];
    for (let index = 0; index < workerCount; index += 1) {
      const child = spawn(process.execPath, [path.join(repoRoot, "chaos", "scripts", "cpu-hog-worker.mjs"), String(scenario.durationMs)], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      pipeProcessOutput(child, logPath, `[cpu-${index + 1}]`);
      workers.push(child);
    }
    control.activeFaultProcess = workers;
    timeline.push(mark("cpu_hogs_started"));

    await Promise.all(workers.map((worker) => onceExit(worker)));
    timeline.push(mark("cpu_hogs_finished"));
    control.activeFaultProcess = null;
    return;
  }

  throw new Error(`Unsupported injection type: ${injection.type}`);
}

async function cleanupFault(scenario, control, logPath) {
  const injection = scenario.injection;

  if (injection.type === "patch-cycle") {
    const original = originalFiles.get(injection.file);
    if (original) {
      await writeFile(injection.file, original, "utf8");
    }
  }

  if (Array.isArray(control.activeFaultProcess)) {
    for (const child of control.activeFaultProcess) {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }
    await appendLog(logPath, "[runner] force-cleaned active CPU hog processes\n");
  }
}

async function runProbeLoop({ scenario, control, samples, cycles, logPath }) {
  while (control.running) {
    const cycleStartedAt = Date.now();
    const cyclePhase = control.phase;
    const cycleSamples = [];

    const loginSample = await probeLogin(cyclePhase);
    samples.push(loginSample);
    cycleSamples.push(loginSample);

    const token = loginSample.token || null;

    const moviesSample = await probeGet("/api/movies", "movies", cyclePhase);
    samples.push(moviesSample);
    cycleSamples.push(moviesSample);

    const profileSample = token
      ? await probeGet("/api/users/profile", "profile", cyclePhase, token)
      : blockedSample("profile", cyclePhase, "login_failed");
    samples.push(profileSample);
    cycleSamples.push(profileSample);

    const recommendSample = token
      ? await probeGet("/api/recommend", "recommend", cyclePhase, token)
      : blockedSample("recommend", cyclePhase, "login_failed");
    samples.push(recommendSample);
    cycleSamples.push(recommendSample);

    cycles.push({
      startedAt: cycleStartedAt,
      phase: cyclePhase,
      healthy: cycleSamples.every((entry) => entry.outcome === "success"),
      samples: cycleSamples.map((entry) => ({
        endpoint: entry.endpoint,
        outcome: entry.outcome,
        statusCode: entry.statusCode,
        durationMs: entry.durationMs,
      })),
    });

    const cycleElapsed = Date.now() - cycleStartedAt;
    await appendLog(logPath, `[probe] phase=${cyclePhase} cycleMs=${cycleElapsed} outcomes=${cycleSamples.map((entry) => `${entry.endpoint}:${entry.outcome}`).join(",")}\n`);

    const sleepMs = Math.max(0, chaosConfig.probeIntervalMs - cycleElapsed);
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  async function probeLogin(phase) {
    const startedAt = Date.now();

    try {
      const response = await fetchWithTimeout(`${chaosConfig.baseUrl}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: chaosConfig.loginEmail,
          password: chaosConfig.loginPassword,
        }),
      });
      const durationMs = Date.now() - startedAt;
      const body = await tryReadJson(response);
      const token = response.ok ? body?.token || null : null;

      return {
        endpoint: "login",
        phase,
        timestamp: startedAt,
        durationMs,
        statusCode: response.status,
        outcome: response.ok ? "success" : "http_error",
        token,
      };
    } catch (error) {
      return failureSample("login", phase, startedAt, error);
    }
  }

  async function probeGet(route, endpoint, phase, token) {
    const startedAt = Date.now();

    try {
      const response = await fetchWithTimeout(`${chaosConfig.baseUrl}${route}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const durationMs = Date.now() - startedAt;

      return {
        endpoint,
        phase,
        timestamp: startedAt,
        durationMs,
        statusCode: response.status,
        outcome: response.ok ? "success" : "http_error",
      };
    } catch (error) {
      return failureSample(endpoint, phase, startedAt, error);
    }
  }
}

function blockedSample(endpoint, phase, reason) {
  return {
    endpoint,
    phase,
    timestamp: Date.now(),
    durationMs: 0,
    statusCode: null,
    outcome: "dependency_blocked",
    error: reason,
  };
}

function failureSample(endpoint, phase, startedAt, error) {
  return {
    endpoint,
    phase,
    timestamp: startedAt,
    durationMs: Date.now() - startedAt,
    statusCode: null,
    outcome: "network_error",
    error: error instanceof Error ? error.message : String(error),
  };
}

function analyzeScenario({ scenario, samples, cycles, control, timeline }) {
  const steadyWindow = getSteadyFaultWindow(timeline);
  const byEndpoint = new Map();
  for (const sample of samples) {
    const current = byEndpoint.get(sample.endpoint) || {
      endpoint: sample.endpoint,
      total: 0,
      success: 0,
      failures: 0,
      blocked: 0,
      preLatencies: [],
      faultLatencies: [],
      steadyFaultLatencies: [],
      steadyFaultFailures: 0,
      postLatencies: [],
    };

    current.total += 1;
    if (sample.outcome === "success") {
      current.success += 1;
      if (sample.phase === "pre-fault") current.preLatencies.push(sample.durationMs);
      if (sample.phase === "fault") current.faultLatencies.push(sample.durationMs);
      if (isInsideWindow(sample.timestamp, steadyWindow)) current.steadyFaultLatencies.push(sample.durationMs);
      if (sample.phase === "post-fault") current.postLatencies.push(sample.durationMs);
    } else if (sample.outcome === "dependency_blocked") {
      current.blocked += 1;
      current.failures += 1;
      if (isInsideWindow(sample.timestamp, steadyWindow)) current.steadyFaultFailures += 1;
    } else {
      current.failures += 1;
      if (isInsideWindow(sample.timestamp, steadyWindow)) current.steadyFaultFailures += 1;
    }

    byEndpoint.set(sample.endpoint, current);
  }

  const faultSamples = samples.filter((sample) => sample.phase === "fault");
  const successfulChecks = samples.filter((sample) => sample.outcome === "success").length;
  const totalChecks = samples.length || 1;
  const faultSuccess = faultSamples.filter((sample) => sample.outcome === "success").length;
  const faultTotal = faultSamples.length || 1;
  const impactedEndpoints = Array.from(byEndpoint.values())
    .filter((entry) => entry.steadyFaultFailures > 0 || avg(entry.steadyFaultLatencies) - avg(entry.preLatencies) > 500)
    .map((entry) => entry.endpoint);

  const firstHealthyPostFault = cycles.find((cycle) => cycle.phase === "post-fault" && cycle.healthy);
  const mttrMs = control.faultClearedAt && firstHealthyPostFault
    ? firstHealthyPostFault.startedAt - control.faultClearedAt
    : null;

  return {
    availabilityPct: pct(successfulChecks, totalChecks),
    faultWindowAvailabilityPct: pct(faultSuccess, faultTotal),
    mttrMs,
    sampleCount: samples.length,
    cycleCount: cycles.length,
    errorPropagation: Array.from(byEndpoint.values()).map((entry) => ({
      endpoint: entry.endpoint,
      failures: entry.failures,
      blocked: entry.blocked,
      availabilityPct: pct(entry.success, entry.total || 1),
      avgPreLatencyMs: round(avg(entry.preLatencies)),
      avgFaultLatencyMs: round(avg(entry.faultLatencies)),
      avgPostLatencyMs: round(avg(entry.postLatencies)),
    })),
    impactedEndpoints,
    gracefulDegradation: impactedEndpoints.length < byEndpoint.size,
    recoveryObserved: mttrMs !== null,
    timeline,
    notes: buildNotes(scenario, impactedEndpoints, mttrMs, byEndpoint),
  };
}

function buildNotes(scenario, impactedEndpoints, mttrMs, byEndpoint) {
  if (scenario.id === "API-DOWN-01") {
    return mttrMs === null
      ? "Backend downtime caused full API unavailability and the service did not recover within the observation window."
      : `Backend restart restored service after the downtime window; first fully healthy probe returned ${mttrMs} ms after fault removal.`;
  }

  if (scenario.id === "NEO4J-FAIL-01") {
    return impactedEndpoints.includes("recommend")
      ? "Recommendation failures stayed mostly isolated to the Neo4j-backed endpoint, showing partial graceful degradation."
      : "Neo4j fault did not surface clearly in the recommendation path.";
  }

  if (scenario.id === "MONGO-SLOW-01") {
    const movies = byEndpoint.get("movies");
    return `Movie catalog latency increased from ${round(avg(movies?.preLatencies || []))} ms to ${round(avg(movies?.faultLatencies || []))} ms during the injected delay.`;
  }

  if (scenario.id === "NET-LATENCY-01") {
    return "Injected middleware latency degraded all critical flows without necessarily producing hard HTTP failures.";
  }

  return "CPU pressure tested runtime resilience under compute contention across login, profile, and recommendation flows.";
}

function getSteadyFaultWindow(timeline) {
  const faultInjectedAt = findEventTime(timeline, "fault_injected");
  const faultReadyAt = findEventTime(timeline, "fault_ready") || faultInjectedAt;
  const restoreStartAt = findEventTime(timeline, "backend_stopped_for_restore");
  const faultClearedAt = findEventTime(timeline, "fault_cleared");

  return {
    start: faultReadyAt || faultInjectedAt || null,
    end: restoreStartAt || faultClearedAt || null,
  };
}

function findEventTime(timeline, eventName) {
  const event = timeline.find((entry) => entry.event === eventName);
  return event ? Date.parse(event.at) : null;
}

function isInsideWindow(timestamp, window) {
  if (!window.start || !window.end) {
    return false;
  }
  return timestamp >= window.start && timestamp < window.end;
}

function buildReport(startedAt, finishedAt, scenarios) {
  const completed = scenarios.filter((entry) => entry.status === "completed");
  const avgAvailability = completed.length
    ? round(completed.reduce((sum, entry) => sum + (entry.metrics?.availabilityPct || 0), 0) / completed.length)
    : 0;
  const mttrValues = completed
    .map((entry) => entry.metrics?.mttrMs)
    .filter((value) => typeof value === "number");

  return {
    generatedAt: finishedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    appDir: chaosConfig.appDir,
    baseUrl: chaosConfig.baseUrl,
    scenarios,
    totals: {
      executed: scenarios.length,
      completed: completed.length,
      failed: scenarios.filter((entry) => entry.status === "failed").length,
      averageAvailabilityPct: avgAvailability,
      averageMttrMs: mttrValues.length ? round(mttrValues.reduce((sum, value) => sum + value, 0) / mttrValues.length) : null,
    },
  };
}

async function startBackend(logPath) {
  const env = await buildChildEnv();
  const child = spawn(process.execPath, ["src/app.js"], {
    cwd: chaosConfig.backendDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeProcessOutput(child, logPath, "[backend]");
  return child;
}

async function buildChildEnv() {
  const parsedEnv = parseDotenv(await readFile(backendEnvPath, "utf8"));
  return {
    ...process.env,
    ...parsedEnv,
    MOVIE_MATCH_APP_DIR: chaosConfig.appDir,
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
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

async function getOriginalSource(filePath) {
  if (!originalFiles.has(filePath)) {
    originalFiles.set(filePath, await readFile(filePath, "utf8"));
  }
  return originalFiles.get(filePath);
}

function applyTextPatch(source, search, replace, scenarioId) {
  const matches = source.split(search).length - 1;
  if (matches !== 1) {
    throw new Error(`Scenario ${scenarioId} expected one match but found ${matches}.`);
  }
  return source.replace(search, replace);
}

function pipeProcessOutput(child, logPath, prefix) {
  for (const [streamName, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream?.on("data", (chunk) => {
      appendLog(logPath, `${prefix}[${streamName}] ${chunk}`).catch(() => {});
    });
  }
}

async function stopProcess(child, logPath) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");
  const exited = await Promise.race([
    onceExit(child).then(() => true),
    sleep(5000).then(() => false),
  ]);

  if (!exited && child.exitCode === null) {
    child.kill("SIGTERM");
    await onceExit(child).catch(() => {});
  }

  await appendLog(logPath, "[runner] backend process stopped\n");
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

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), chaosConfig.requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function onceExit(child) {
  return new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pct(success, total) {
  if (!total) {
    return 0;
  }
  return round((success / total) * 100);
}

function avg(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Number(value.toFixed(2));
}

function mark(event) {
  return {
    event,
    at: new Date().toISOString(),
  };
}

async function appendLog(logPath, text) {
  await appendFile(logPath, text, "utf8");
}

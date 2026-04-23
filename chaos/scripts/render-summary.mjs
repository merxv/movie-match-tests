import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const resultsDir = path.join(repoRoot, "chaos", "results");
const rawReportPath = path.join(resultsDir, "latest-run.json");
const jsonPath = path.join(resultsDir, "latest-summary.json");
const markdownPath = path.join(resultsDir, "latest-summary.md");

await mkdir(resultsDir, { recursive: true });

const report = JSON.parse(await readFile(rawReportPath, "utf8"));
await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

function renderMarkdown(report) {
  const completed = report.scenarios.filter((entry) => entry.status === "completed");
  const failed = report.scenarios.filter((entry) => entry.status === "failed");

  return [
    "# Chaos / Fault Injection Summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Base URL: ${report.baseUrl}`,
    `- App under test: ${report.appDir}`,
    `- Scenarios executed: ${report.totals.executed}`,
    `- Average availability: ${report.totals.averageAvailabilityPct}%`,
    `- Average MTTR: ${report.totals.averageMttrMs ?? "not observed"} ms`,
    "",
    "## Chaos testing plan",
    "",
    "| Scenario | Failure type | Duration (ms) | Affected module | Description |",
    "| --- | --- | ---: | --- | --- |",
    ...report.scenarios.map((entry) => `| ${entry.id} | ${entry.faultType} | ${entry.durationMs} | ${entry.module} | ${entry.description} |`),
    "",
    "## Metrics summary",
    "",
    "| Scenario | Status | Availability (%) | Fault-window availability (%) | MTTR (ms) | Impacted endpoints | Log |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ...report.scenarios.map((entry) => `| ${entry.id} | ${entry.status} | ${entry.metrics?.availabilityPct ?? 0} | ${entry.metrics?.faultWindowAvailabilityPct ?? 0} | ${entry.metrics?.mttrMs ?? "n/a"} | ${(entry.metrics?.impactedEndpoints || []).join(", ") || "none"} | ${normalizePath(entry.logPath)} |`),
    "",
    "## Behavior report",
    "",
    ...report.scenarios.flatMap((entry) => [
      `### ${entry.id}`,
      "",
      `- Fault type: ${entry.faultType}`,
      `- Status: ${entry.status}`,
      `- Availability: ${entry.metrics?.availabilityPct ?? 0}% overall, ${entry.metrics?.faultWindowAvailabilityPct ?? 0}% during the fault window`,
      `- MTTR: ${entry.metrics?.mttrMs ?? "not observed"} ms`,
      `- Graceful degradation: ${entry.metrics?.gracefulDegradation ? "yes" : "no"}`,
      `- Recovery observed: ${entry.metrics?.recoveryObserved ? "yes" : "no"}`,
      `- Observation: ${entry.metrics?.notes || "No notes."}`,
      "",
      "| Endpoint | Availability (%) | Failures | Blocked | Avg pre-fault latency (ms) | Avg fault latency (ms) | Avg post-fault latency (ms) |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...(entry.metrics?.errorPropagation || []).map((row) => `| ${row.endpoint} | ${row.availabilityPct} | ${row.failures} | ${row.blocked} | ${row.avgPreLatencyMs} | ${row.avgFaultLatencyMs} | ${row.avgPostLatencyMs} |`),
      "",
    ]),
    "## Failed scenarios",
    "",
    ...(failed.length
      ? failed.map((entry) => `- ${entry.id}: ${entry.failureReason}`)
      : ["- None"]),
    "",
    "## Lessons learned",
    "",
    ...renderLessons(completed),
    "",
  ].join("\n");
}

function renderLessons(completed) {
  const lessons = [];

  const isolatedNeo4j = completed.find((entry) => entry.id === "NEO4J-FAIL-01");
  if (isolatedNeo4j?.metrics?.gracefulDegradation) {
    lessons.push("- Recommendation faults were more isolated than full-service outages, which suggests partial fault containment between modules.");
  }

  const globalLatency = completed.find((entry) => entry.id === "NET-LATENCY-01");
  if (globalLatency) {
    lessons.push("- Endpoints can stay technically available while still degrading sharply under latency injection, so resilience checks should track latency budgets as well as status codes.");
  }

  const downtime = completed.find((entry) => entry.id === "API-DOWN-01");
  if (downtime) {
    lessons.push("- Backend restarts create a visible availability gap; adding health-aware restarts or external supervision would reduce user-facing downtime.");
  }

  const profileOrMovies = completed.find((entry) => entry.id === "MONGO-SLOW-01");
  if (profileOrMovies) {
    lessons.push("- Mongo-backed read paths need tighter timeouts, caching, or pagination because slow database responses directly increase user-perceived latency.");
  }

  const cpu = completed.find((entry) => entry.id === "CPU-STRESS-01");
  if (cpu) {
    lessons.push("- CPU pressure can propagate into authentication and downstream authenticated routes, so runtime saturation needs explicit monitoring and protective limits.");
  }

  lessons.push("- Recommended next steps: add structured health endpoints, retry/backoff for transient graph failures, request timeout guards, and dashboard-based alerting for recovery time.");
  return lessons;
}

function normalizePath(filePath) {
  return filePath ? path.relative(repoRoot, filePath) : "-";
}

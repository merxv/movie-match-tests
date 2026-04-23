import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const resultsDir = path.join(repoRoot, "mutation", "results");
const rawReportPath = path.join(resultsDir, "latest-run.json");
const markdownPath = path.join(resultsDir, "latest-summary.md");
const jsonPath = path.join(resultsDir, "latest-summary.json");

await mkdir(resultsDir, { recursive: true });

const report = await loadReport();
const markdown = renderMarkdown(report);

await writeFile(markdownPath, markdown, "utf8");
await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

async function loadReport() {
  try {
    return JSON.parse(await readFile(rawReportPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        generatedAt: new Date().toISOString(),
        suiteName: "api:all",
        baseUrl: process.env.MUTATION_BASE_URL || "http://127.0.0.1:4000",
        appDir: process.env.MOVIE_MATCH_APP_DIR || "unknown",
        baseline: {
          status: "failed",
          durationMs: 0,
          logPath: null,
          failureReason: "Mutation raw report was not generated because the mutation run failed before writing latest-run.json.",
        },
        mutants: [],
        totals: {
          created: 0,
          killed: 0,
          survived: 0,
          mutationScore: 0,
        },
      };
    }

    throw error;
  }
}

function renderMarkdown(report) {
  const byModule = summarizeByModule(report.mutants || []);
  const survived = (report.mutants || []).filter((entry) => entry.status === "survived");

  return [
    "# Mutation Testing Summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Test suite: ${report.suiteName}`,
    `- Base URL: ${report.baseUrl}`,
    `- App under test: ${report.appDir}`,
    `- Baseline status: ${report.baseline?.status || "unknown"}`,
    `- Mutation score: ${report.totals?.mutationScore ?? 0}%`,
    "",
    "## Baseline execution",
    "",
    `- Status: ${report.baseline?.status || "unknown"}`,
    `- Duration: ${report.baseline?.durationMs ?? 0} ms`,
    `- Log: ${normalizeLogPath(report.baseline?.logPath)}`,
    ...(report.baseline?.failureReason ? [`- Failure reason: ${report.baseline.failureReason}`] : []),
    "",
    "## Overall metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Mutants created | ${report.totals?.created ?? 0} |`,
    `| Mutants killed | ${report.totals?.killed ?? 0} |`,
    `| Mutants survived | ${report.totals?.survived ?? 0} |`,
    `| Mutation score (%) | ${report.totals?.mutationScore ?? 0} |`,
    "",
    "## Module breakdown",
    "",
    "| Module / Component | Mutant Type | Mutants Created | Mutants Killed | Mutants Survived | Mutation Score (%) |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...byModule.map((row) => `| ${row.module} | ${row.mutantTypes} | ${row.created} | ${row.killed} | ${row.survived} | ${row.score} |`),
    "",
    "## Detailed mutant execution",
    "",
    "| ID | Module | Mutant Type | Status | Description | Log |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(report.mutants || []).map((entry) => `| ${entry.id} | ${entry.module} | ${entry.mutantType} | ${entry.status} | ${entry.description} | ${normalizeLogPath(entry.logPath)} |`),
    "",
    "## Surviving mutants analysis",
    "",
    ...((report.mutants || []).length === 0
      ? ["No mutants were executed because the baseline run failed."]
      : survived.length
      ? [
          "| ID | Impact / Gap | Recommended test improvement |",
          "| --- | --- | --- |",
          ...survived.map((entry) => `| ${entry.id} | ${explainGap(entry)} | ${recommendImprovement(entry)} |`),
        ]
      : ["All mutants were killed by the current automated suite."]),
    "",
    "## Mutation plan",
    "",
    "Critical backend modules were selected from the earlier performance analysis and current API coverage: authentication/authorization, profile-like sync, movie catalog/admin CRUD, and recommendations.",
    "Mutations were intentionally small and realistic: logical operator changes, constant alterations, function removals, and return-value modifications.",
    "Execution strategy: start the original backend, seed deterministic MongoDB/Neo4j data, run `sync` and `admin` Postman/Newman suites, then repeat the same cycle for each mutant while restoring the original file after the run.",
    ...(report.baseline?.status !== "passed"
      ? [
          "",
          "## Blocker",
          "",
          "The baseline application did not become test-ready, so mutant execution was intentionally stopped. Fix the baseline environment first, then rerun `node .\\mutation\\scripts\\run-mutation-tests.mjs`.",
        ]
      : []),
    "",
  ].join("\n");
}

function summarizeByModule(mutants) {
  const groups = new Map();

  for (const mutant of mutants) {
    const current = groups.get(mutant.module) || {
      module: mutant.module,
      mutantTypes: new Set(),
      created: 0,
      killed: 0,
      survived: 0,
    };

    current.mutantTypes.add(mutant.mutantType);
    current.created += 1;
    if (mutant.status === "killed") {
      current.killed += 1;
    } else if (mutant.status === "survived") {
      current.survived += 1;
    }

    groups.set(mutant.module, current);
  }

  return Array.from(groups.values()).map((entry) => ({
    module: entry.module,
    mutantTypes: Array.from(entry.mutantTypes).join(", "),
    created: entry.created,
    killed: entry.killed,
    survived: entry.survived,
    score: entry.created === 0 ? 0 : Number(((entry.killed / entry.created) * 100).toFixed(2)),
  }));
}

function normalizeLogPath(logPath) {
  return logPath ? path.relative(repoRoot, logPath) : "-";
}

function explainGap(entry) {
  if (entry.module === "Recommendation Engine") {
    return "Current API suite never calls `/api/recommend`, so recommendation ranking and result-count regressions go undetected.";
  }

  if (entry.module === "Profile / Like Sync") {
    return "Profile assertions cover presence/absence of liked movies but do not validate non-critical fields in the response payload.";
  }

  return "The current suite exercises the route, but its assertions do not validate the mutated behavior deeply enough.";
}

function recommendImprovement(entry) {
  if (entry.module === "Recommendation Engine") {
    return "Add authenticated API tests that seed deterministic likes and assert recommendation count, ordering, and score composition.";
  }

  if (entry.module === "Profile / Like Sync") {
    return "Add schema-level assertions for `bannerUrl`, `likeTimestamp`, and other user-profile fields returned by `/api/users/profile`.";
  }

  return "Add assertions around response payload semantics, not only status codes.";
}

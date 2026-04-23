import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('performance/results/latest-summary.json');

const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve('performance/results/latest-summary.md');

const raw = await readFile(targetPath, 'utf8');
const summary = JSON.parse(raw);

const lines = [
  '# Performance Summary',
  '',
  `- Generated at: ${summary.generatedAt}`,
  `- Profile: ${summary.profile}`,
  `- Base URL: ${summary.baseUrl}`,
  '',
  '## High-risk modules',
  '',
  ...summary.highRiskModules.map((item) => `- ${item}`),
  '',
  '## Response time summary',
  '',
  '| Metric | Average (ms) | Median (ms) | P95 (ms) |',
  '| --- | ---: | ---: | ---: |',
  `| Overall HTTP | ${format(summary.metrics.httpReqDuration.avg)} | ${format(summary.metrics.httpReqDuration.median)} | ${format(summary.metrics.httpReqDuration.p95)} |`,
  `| Movies | ${format(summary.metrics.endpointDurations.movies.avg)} | ${format(summary.metrics.endpointDurations.movies.median)} | ${format(summary.metrics.endpointDurations.movies.p95)} |`,
  `| Recommendations | ${format(summary.metrics.endpointDurations.recommendations.avg)} | ${format(summary.metrics.endpointDurations.recommendations.median)} | ${format(summary.metrics.endpointDurations.recommendations.p95)} |`,
  `| Auth | ${format(summary.metrics.endpointDurations.auth.avg)} | ${format(summary.metrics.endpointDurations.auth.median)} | ${format(summary.metrics.endpointDurations.auth.p95)} |`,
  `| Profile | ${format(summary.metrics.endpointDurations.profile.avg)} | ${format(summary.metrics.endpointDurations.profile.median)} | ${format(summary.metrics.endpointDurations.profile.p95)} |`,
  '',
  '## Throughput and errors',
  '',
  `- Requests per second: ${format(summary.metrics.throughput.requestsPerSecond)}`,
  `- Iterations per second: ${format(summary.metrics.throughput.iterationsPerSecond)}`,
  `- HTTP error rate: ${formatPercent(summary.metrics.errorRate.httpReqFailed)}`,
  `- Application error rate: ${formatPercent(summary.metrics.errorRate.applicationErrors)}`,
  `- Completed business flows: ${summary.metrics.businessFlowsCompleted ?? 'n/a'}`,
  '',
  '## Thresholds',
  '',
  `- Target p95: ${summary.thresholds.p95}`,
  `- Target error rate: ${summary.thresholds.errorRate}`,
  `- Throughput expectation: ${summary.thresholds.throughput}`,
  '',
];

await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote markdown summary to ${outputPath}`);

function format(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'n/a';
  }

  return Number(value).toFixed(2);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'n/a';
  }

  return `${(Number(value) * 100).toFixed(2)}%`;
}

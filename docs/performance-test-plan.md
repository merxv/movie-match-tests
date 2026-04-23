# Assignment 3 Performance Test Plan

## Scope

Performance testing targets the MovieMatch backend in `ass6ver2\backend` with focus on the three highest-risk components from the API design and data access patterns:

1. Movie catalog module: `GET /api/movies`
2. Recommendation module: `GET /api/recommend`
3. User auth/profile module: `POST /api/users/login`, `GET /api/users/profile`

## Test scenarios

| Scenario | Purpose | Load model | Duration | Pass thresholds |
| --- | --- | --- | --- | --- |
| Normal load | Validate steady-state behavior under expected traffic | ramp to 10 VUs | 5 min | avg < 450 ms, p95 < 800 ms, errors < 1% |
| Peak load | Validate expected busy-hour traffic | ramp to 40 VUs | 11 min | avg < 800 ms, p95 < 1500 ms, errors < 2% |
| Spike load | Validate burst tolerance and recovery | jump from 10 to 80 VUs | 3 min | avg < 1200 ms, p95 < 2500 ms, errors < 5% |
| Endurance | Detect saturation, leaks, and long-run degradation | 15 constant VUs | 20 min | avg < 650 ms, p95 < 1200 ms, errors < 2% |

## Workload mix

Each virtual user executes one business-flow iteration containing:

- `GET /api/movies`
- `GET /api/recommend` with bearer token
- `POST /api/users/login`
- `GET /api/users/profile` with the fresh token

This mix emphasizes read-heavy behavior while still exercising CPU-heavy authentication and MongoDB populate logic.

## Metrics to collect

Application metrics from `k6`:

- response time: average, median, p90, p95, max
- throughput: requests per second, iterations per second
- error rate: `http_req_failed`, custom `application_errors`
- endpoint-specific trends:
  `movies_duration`, `recommendations_duration`, `auth_duration`, `profile_duration`

Infrastructure metrics from Windows Performance Monitor:

- CPU total utilization
- available memory
- disk transfers per second
- average disk queue length
- Node.js process CPU
- Node.js private working set

## Expected bottlenecks

| Module | Risk hypothesis | Why it matters |
| --- | --- | --- |
| Recommendations | Neo4j hybrid query pair plus in-memory merge will dominate p95 under concurrency | two graph traversals per request and sort/merge in Node.js |
| Movies catalog | Full collection read without paging can degrade with dataset growth | MongoDB returns the whole movie set on every request |
| Auth/profile | bcrypt compare and profile populate may increase CPU and memory pressure | every login hashes, every profile loads liked movies plus interaction history |

## Execution steps

1. Generate app env files with `npm run ci:write-env`.
2. Start MongoDB, Neo4j, and the backend service.
3. Seed deterministic data with `npm run ci:seed`.
4. Start resource monitoring with `performance/scripts/collect-system-metrics.ps1`.
5. Run one `k6` scenario profile.
6. Generate markdown summary with `npm run perf:report`.
7. Build charts from `latest-summary.json` and `system-metrics-*.csv` for the report.

## Evidence to attach to the assignment

- test plan with scenario table and thresholds
- terminal screenshots for each run
- raw `k6` summary JSON files
- Windows resource CSV export
- response-time and throughput charts
- bottleneck analysis with optimization recommendations

# Chaos / Fault Injection Testing

Chaos testing for the MovieMatch backend lives in this folder and mirrors the structure used for `performance/` and `mutation/`.

## Scope

- Application under test: `C:\Users\legionnaire\Desktop\study\1 trimester\базы данных\ass6ver2`
- Critical flows observed during each scenario:
  - `POST /api/users/login`
  - `GET /api/movies`
  - `GET /api/users/profile`
  - `GET /api/recommend`
- High-risk modules covered:
  - API availability
  - MongoDB-backed catalog/profile paths
  - Neo4j-backed recommendation path
  - Node.js runtime under CPU pressure

## Injected fault types

- API downtime by stopping and restarting the backend process
- Database slow response by adding delay to the Mongo-backed movie catalog path
- Database failure by forcing the recommendation path to return `503`
- Network latency by adding an artificial middleware delay to all API requests
- Resource exhaustion by spawning CPU hog worker processes

## Commands

```powershell
npm run chaos:run
npm run chaos:report
```

If the target app uses an existing backend `.env`, the runner keeps it. If `.env` is missing, the runner writes CI-style defaults automatically. To force overwriting the app `.env`, set `CHAOS_WRITE_ENV=1`.

## Outputs

- `chaos/results/latest-run.json`
- `chaos/results/latest-summary.json`
- `chaos/results/latest-summary.md`
- `chaos/results/logs/*.log`

## Metrics captured

- overall availability during the whole scenario
- availability during the active fault window
- MTTR measured from fault removal to the first fully healthy probe cycle
- endpoint-level error propagation
- pre-fault, fault-window, and post-fault latency trends

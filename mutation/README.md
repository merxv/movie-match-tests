# Mutation Testing

Mutation testing for the MovieMatch backend lives in this folder and mirrors the structure used for `performance/`.

## Scope

- Application under test: `C:\Users\legionnaire\Desktop\study\1 trimester\базы данных\ass6ver2`
- Automated suite used for mutation runs: existing Postman/Newman API scenarios from this repository
- Critical modules covered by the mutation plan:
  - authentication / authorization
  - profile and like/unlike synchronization
  - movie catalog and admin CRUD
  - recommendation engine

## What the runner does

1. Uses the target backend `.env` if it already exists. If `.env` is missing, it writes CI-style env files automatically.
2. Starts the backend on `http://127.0.0.1:4000`.
3. Seeds deterministic MongoDB and Neo4j data.
4. Runs `sync` and `admin` API suites as the baseline.
5. Applies each mutant one at a time, reruns the same suite, records `killed` or `survived`, and restores the original source file.
6. Generates:
   - `mutation/results/latest-run.json`
   - `mutation/results/latest-summary.json`
   - `mutation/results/latest-summary.md`
   - `mutation/results/logs/*.log`

## Commands

```powershell
npm run mutation:run
npm run mutation:report
```

If the app directory differs, set `MOVIE_MATCH_APP_DIR` before running.
If you explicitly want the runner to overwrite the app `.env` with CI defaults, set `MUTATION_WRITE_ENV=1`.

## Prerequisites

- MongoDB must be reachable by the backend `.env` value in `MONGO_URI`
- Neo4j must be running and reachable on the configured `NEO4J_URI`
- The target app's backend dependencies must already be installed

## Interpreting results

- `Killed`: the automated suite detected the injected fault through a failed assertion, failed validation, or startup/runtime failure.
- `Survived`: the mutated behavior passed through the current automated suite undetected.
- `Mutation score`: `killed / created * 100`.

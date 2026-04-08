# movie-match-tests

WebdriverIO end-to-end tests for MovieMatch.

## CI setup

The GitHub Actions workflow in this repo now:

- starts MongoDB and Neo4j as GitHub Actions services
- checks out the MovieMatch app from a separate GitHub repository
- installs backend, frontend, and test dependencies
- writes CI-safe `.env` files for the app
- starts backend on `4000` and frontend on `5173`
- waits until both apps are reachable
- seeds deterministic test data into MongoDB and Neo4j
- runs WebdriverIO tests
- uploads Allure HTML and app logs as artifacts

Before the workflow can pass, publish the MovieMatch app repository to GitHub and set:

- repository variable `MOVIE_MATCH_APP_REPOSITORY`: `owner/repo` of the app repository
- optional repository variable `MOVIE_MATCH_APP_REF`: branch or tag to checkout, defaults to `main`
- optional secret `MOVIE_MATCH_APP_TOKEN`: PAT with access to the app repo if it is private

## Local run

1. Clone the MovieMatch app repo somewhere locally.
2. Install dependencies in this repo: `npm ci`
3. Install dependencies in the app repo:
   `cd backend && npm ci`
   `cd frontend && npm ci`
4. From this repo, generate CI-style env files for the app:

```bash
npm run ci:write-env -- /absolute/path/to/moviematch
```

5. Start the backend from the app repo: `npm run start`
6. Start the frontend from the app repo: `npm run dev -- --host 127.0.0.1 --port 5173`
7. Seed databases from this repo:

```bash
npm run ci:seed
```

8. Run tests:

```bash
npx wdio run wdio.conf.js
```

If you need a different frontend URL, set `MOVIE_MATCH_BASE_URL` before running WDIO.

## API tests with Postman/Newman

API suites live in `api-tests/`:

- `sync.json` (`S03 / TC04`) logs in as Steve, likes a seeded movie, and verifies the API response chain
- `admin.json` (`S04 / TC05`) logs in as Steve as admin and creates a movie through the admin endpoint

The Newman runner is wrapped by `scripts/api/run-postman-suite.mjs` and then performs backend validation against MongoDB and Neo4j.

Local flow:

1. Generate app `.env` files:

```bash
npm run ci:write-env -- "C:\Users\legionnaire\Desktop\study\1 trimester\базы данных\ass6ver2"
```

2. Start the backend from the app repo:

```bash
cd "C:\Users\legionnaire\Desktop\study\1 trimester\базы данных\ass6ver2\backend"
npm start
```

3. Seed deterministic test data from this repo:

```bash
cd "C:\Users\legionnaire\Desktop\Advanced-QA\movie-match-tests"
npm run ci:seed
```

4. Run API suites:

```bash
npm run api:sync
npm run api:admin
npm run api:all
```

Notes:

- `api-tests/environment.local.json` contains the default local base URL and Steve credentials
- `sync` now reverts its own like with `DELETE /api/users/unlike/:movieId`, so it should not leave changed liked movies behind
- `api:admin` creates a temporary movie and deletes it in the same collection run
- if you want strict Mongo/Neo4j validation in addition to API assertions, export `MONGO_URI` and `NEO4J_*` or set `MOVIE_MATCH_APP_DIR`

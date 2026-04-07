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

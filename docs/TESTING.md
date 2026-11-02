# Testing

Backend tests and local-mode browser tests use disposable databases and mocked OpenRouter responses. They do not read or require the root `.env` or make paid AI requests.

## Backend

From the repository root:

```sh
uv sync --directory backend --group dev --locked
uv run --directory backend python -m pytest
```

Pytest enforces at least 85% combined statement/branch coverage for `app`. SQLite integration tests exercise registration, login, throttling, password rotation, session replay rejection, account deletion, all owned-board routes, task metadata, assistant approval and rollback, migration from existing data, restart persistence, and concurrent writes/initialization.

Set `TEST_DATABASE_URL` to a test PostgreSQL database to enable the PostgreSQL integration test. It creates a unique temporary schema and drops only that schema afterward; the database role needs schema-creation permission. Never use a production connection for tests. CI provides its own PostgreSQL service.

## Frontend

From `frontend`:

```sh
npm ci
npm run lint
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers every component and board utility, with gates of 85% lines/statements/functions and 75% branches. Coverage reports are generated in `frontend/coverage` and ignored by git.

Playwright normally starts Docker Compose, which uses Compose's configured environment and data volume; use that mode only with a disposable test instance. For isolated tests without Docker, first sync the backend environment and build the frontend, then run with `PLAYWRIGHT_LOCAL=1`. This serves the actual static export through FastAPI on loopback port 8017 using the backend virtual environment and an isolated SQLite database. It does not reuse an existing server or application database. Optionally set `E2E_DATABASE_PATH` to an explicit disposable path.

PowerShell:

```powershell
$env:PLAYWRIGHT_LOCAL = "1"
npm run test:e2e
```

macOS/Linux:

```sh
PLAYWRIGHT_LOCAL=1 npm run test:e2e
```

Browser tests cover real registration, account/password changes and session revocation, multiple-board CRUD, task CRUD/metadata/search, persisted stage changes, user isolation, AI approval/failure/history clearing, and responsive layouts from 390px to 2560px. Workspace workflows use real API/database responses; assistant responses are mocked, and responsive layout checks use deterministic API fixtures.

The GitHub Actions workflow runs backend coverage with PostgreSQL integration, frontend coverage, lint, production build, and the Chromium suite. Docker image rebuilding and live hosted deployment remain separate checks requiring those environments.

# Backend Guide

## Current Backend

- `app/main.py` defines the FastAPI application.
- `/` serves the static Next.js export from `STATIC_DIR` when the export directory exists. The local default is `frontend/out`; Docker sets it to `/app/static`.
- `/api/auth/*` handles registration, login, identity, logout, password changes, and confirmed account deletion. Passwords use salted scrypt hashes; signed HttpOnly sessions are revocable.
- `/api/boards` lists/creates private boards. Nested board, column, card, and assistant routes require authenticated ownership. SQLite/PostgreSQL migrations preserve existing data.
- `GET /api/health` returns a health status; `GET /api/hello` returns a sample API response.
- Tests cover authentication, migrations, board workflows and isolation with temporary SQLite databases; `TEST_DATABASE_URL` enables disposable-schema PostgreSQL integration. Pytest enforces coverage; see `../docs/TESTING.md`.
- `pyproject.toml` declares runtime and development dependencies; `uv.lock` pins their resolved versions.
- The root `Dockerfile` builds the frontend static export in a Node stage, installs locked Python runtime dependencies with `uv`, and starts Uvicorn. `compose.yaml` publishes port 8000 by default.

## Conventions

- Use FastAPI and Python 3.12 or newer. Manage backend dependencies with `uv` and update `uv.lock` when dependencies change.
- Set `DATABASE_PATH` and `SESSION_SECRET` through the environment when overriding local defaults. Compose stores the database in its `kanban-data` volume.
- Keep API logic in `app/`; add backend tests under `tests/`.
- Do not place secrets in source or log credentials. The project-root `.env` is excluded from version control and the Docker build context.
- Follow the staged scope and approval gates in `../docs/PLAN.md`. Keep API routes under `/api` so the root static-file mount does not shadow them.

## Tests

From the repository root, synchronize development dependencies and run the backend tests:

```sh
uv sync --directory backend --group dev
uv run --directory backend python -m pytest
```
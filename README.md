# Kanban App

Private project workspaces with account registration, password management, multiple named boards, task priorities and due dates, search, progress tracking, drag-and-drop or keyboard-accessible stage changes, and a board-scoped AI assistant with explicit change approval.

## Requirements

- Docker with the Compose plugin

## Run

Windows PowerShell:

```powershell
./scripts/start.ps1
./scripts/stop.ps1
```

macOS or Linux:

```sh
bash scripts/start.sh
bash scripts/stop.sh
```

The app is served at `http://localhost:8000` by default. Set `APP_PORT` to use another host port.

If startup reports that port 8000 is already in use, leave the other service running and choose a free port:

```powershell
$env:APP_PORT = "8001"
.\scripts\start.ps1
```

On macOS/Linux, use `APP_PORT=8001 bash scripts/start.sh`. Open `http://localhost:8001`. To keep this port across terminal sessions, set `APP_PORT=8001` in the project-root `.env`.

If an existing Docker volume reports `attempt to write a readonly database` after upgrading to the non-root container, repair its ownership once while the container is running:

```sh
docker compose exec --user 0:0 app chown 10001:10001 /data /data/kanban.sqlite3
```

This preserves existing board data; do not delete the volume.

FastAPI serves the statically built app at `/`. Create an account with a password of at least 12 characters, or use the initial development account `user` / `password`. Production requires a private `MVP_PASSWORD` for initial seeding; later password changes use account settings. Existing databases migrate automatically without replacing boards or cards. Back up your database before upgrading.

To explicitly check OpenRouter connectivity, run `docker compose exec app python -m app.openrouter_check` after setting `OPENROUTER_API_KEY` in the project-root `.env`.

## Deploy

The selected hosted setup is a Render Free Docker web service with Supabase Free PostgreSQL. Follow [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md) to configure the Render Blueprint and database. The repository does not create cloud resources or migrate local SQLite data. Free-tier inactivity and storage limits apply; this is not a production-availability guarantee.

Local Docker Compose continues to use SQLite. Keep production secrets in the provider's secret settings, never in the repository or image.

## Tests

See [docs/TESTING.md](docs/TESTING.md) for coverage gates, SQLite/PostgreSQL integration tests, and browser tests with or without Docker. CI runs all three layers.
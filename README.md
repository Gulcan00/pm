# Kanban App

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

FastAPI serves the statically built Kanban app at `/`. Local development sign-in is `user` / `password`; production requires a private `MVP_PASSWORD`. `/api/health` and `/api/hello` are available for smoke checks.

To explicitly check OpenRouter connectivity, run `docker compose exec app python -m app.openrouter_check` after setting `OPENROUTER_API_KEY` in the project-root `.env`.

## Deploy

The selected hosted setup is a Render Free Docker web service with Supabase Free PostgreSQL. Follow [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md) to configure the Render Blueprint and database. The repository does not create cloud resources or migrate local SQLite data. Free-tier inactivity and storage limits apply; this is not a production-availability guarantee.

Local Docker Compose continues to use SQLite. Keep production secrets in the provider's secret settings, never in the repository or image.
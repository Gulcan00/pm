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

Deploy the repository as a Docker image on a platform that supports persistent writable storage. Configure `APP_ENV=production`, `PORT` to the port supplied by the platform, `SESSION_SECRET` to a unique random value of at least 32 characters, `MVP_PASSWORD` to a unique password of at least 12 characters, and `OPENROUTER_API_KEY` if AI requests should be enabled. Keep these values in the platform's secret settings, not in the image or source control.

Generate a session secret locally with `openssl rand -hex 32` (macOS/Linux) or `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))` (PowerShell), then add it directly to the platform's secret settings.

Mount persistent storage at `/data` and keep `DATABASE_PATH=/data/kanban.sqlite3`. The app runs as UID 10001, so the mounted directory must be writable by that user. Free services with ephemeral filesystems are not suitable for persistent boards; their restarts or redeploys can erase the SQLite database. Check the platform's current storage and inactivity policies before deploying. Use HTTPS so the production session cookie is sent by browsers.

For local production-mode checks, set the same environment variables in the project-root `.env` before running Compose. Compose remains bound to `127.0.0.1` unless `APP_BIND` is explicitly changed.

For a free OCI VM deployment that preserves SQLite, see [docs/DEPLOY-OCI.md](docs/DEPLOY-OCI.md). It includes a separate Compose stack with Caddy-managed HTTPS; cloud account, VM, and DNS provisioning are manual.
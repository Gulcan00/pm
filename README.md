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

FastAPI serves the statically built Kanban app at `/`. Sign in with `user` / `password`. `/api/health` and `/api/hello` are available for smoke checks.
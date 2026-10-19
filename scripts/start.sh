#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

docker compose up -d --build
printf 'Kanban app is running at http://localhost:%s\n' "${APP_PORT:-8000}"
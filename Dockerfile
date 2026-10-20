FROM node:24-bookworm-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    APP_ENV=production \
    DATABASE_PATH=/data/kanban.sqlite3 \
    STATIC_DIR=/app/static

WORKDIR /app

COPY backend/pyproject.toml ./pyproject.toml
COPY backend/uv.lock ./uv.lock
COPY backend/app ./app
COPY --from=frontend-build /frontend/out ./static

RUN uv sync --locked --no-dev --no-install-project

RUN mkdir -p /data && chown 10001:10001 /data
USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/api/health', timeout=2)"]

CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
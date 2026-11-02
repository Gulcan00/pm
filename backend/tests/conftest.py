import os
from pathlib import Path
from tempfile import TemporaryDirectory


_bootstrap = TemporaryDirectory(prefix="kanban-test-bootstrap-")
_test_environment = {
    "DATABASE_PATH": str(Path(_bootstrap.name) / "kanban.sqlite3"),
    "DATABASE_URL": "",
    "APP_ENV": "development",
    "MVP_PASSWORD": "password",
    "SESSION_SECRET": "isolated-backend-test-session-secret",
    "OPENROUTER_API_KEY": "",
}
_original_environment = {key: os.environ.get(key) for key in _test_environment}
# The ASGI module constructs its default app during test collection.
os.environ.update(_test_environment)


def pytest_unconfigure(config):
    for key, value in _original_environment.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    _bootstrap.cleanup()

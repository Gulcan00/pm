import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import SESSION_COOKIE, create_app



@pytest.fixture
def client(tmp_path):
    app = create_app(
        database_path=tmp_path / "kanban.sqlite3",
        session_secret="test-session-secret",
        static_dir=tmp_path / "static",
    )
    return TestClient(app)


def test_login_seeds_user_and_creates_http_only_session(client) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    assert response.status_code == 200
    assert response.json() == {"id": 1, "username": "user"}
    assert response.cookies.get(SESSION_COOKIE)
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json() == {"id": 1, "username": "user"}


def test_invalid_credentials_do_not_create_a_session(client) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "wrong"}
    )

    assert response.status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_session(client) -> None:
    client.post("/api/auth/login", json={"username": "user", "password": "password"})

    response = client.post("/api/auth/logout")

    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_seeded_user_does_not_store_a_password(client) -> None:
    database_path = client.app.state.database_path
    with sqlite3.connect(database_path) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
        user = connection.execute("SELECT username FROM users").fetchone()

    assert columns == {"id", "username"}
    assert user == ("user",)


def test_health_route(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_hello_route(client) -> None:
    response = client.get("/api/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello from FastAPI"}
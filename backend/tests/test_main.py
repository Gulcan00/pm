import json
import hashlib
import hmac
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import (
    COLUMN_DEFINITIONS,
    AI_REQUEST_LIMIT,
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    create_app,
)
from app.openrouter import OpenRouterError



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


def test_expired_session_cookie_is_rejected(client) -> None:
    signed_value = f"1.{int(time.time()) - 1}"
    signature = hmac.new(
        b"test-session-secret", signed_value.encode(), hashlib.sha256
    ).hexdigest()
    client.cookies.set(SESSION_COOKIE, f"{signed_value}.{signature}")

    assert client.get("/api/auth/me").status_code == 401


def test_session_with_non_numeric_user_id_is_rejected(client) -> None:
    signed_value = f"invalid-user-id.{int(time.time()) + SESSION_TTL_SECONDS}"
    signature = hmac.new(
        b"test-session-secret", signed_value.encode(), hashlib.sha256
    ).hexdigest()
    client.cookies.set(SESSION_COOKIE, f"{signed_value}.{signature}")

    assert client.get("/api/auth/me").status_code == 401


def test_database_url_selects_postgres_without_treating_local_paths_as_urls(
    tmp_path, monkeypatch
) -> None:
    initialized_targets = []
    monkeypatch.setattr("app.main.initialize_database", initialized_targets.append)
    monkeypatch.setenv("DATABASE_URL", "postgres://example")

    postgres_app = create_app(static_dir=tmp_path / "static")

    assert postgres_app.state.database_path == "postgres://example"
    assert initialized_targets == ["postgres://example"]

    monkeypatch.delenv("DATABASE_URL")
    local_app = create_app(static_dir=tmp_path / "static")

    assert isinstance(local_app.state.database_path, type(tmp_path))
    assert local_app.state.database_path.name == "kanban.sqlite3"
    assert isinstance(initialized_targets[1], type(tmp_path))


def test_production_requires_secrets_and_sets_secure_cookie(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    monkeypatch.delenv("MVP_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        create_app(database_path=tmp_path / "production.sqlite3")

    monkeypatch.setenv("SESSION_SECRET", "s" * 40)
    with pytest.raises(RuntimeError, match="MVP_PASSWORD"):
        create_app(database_path=tmp_path / "production.sqlite3")

    monkeypatch.setenv("MVP_PASSWORD", "production-only-password")
    app = create_app(database_path=tmp_path / "production.sqlite3")
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "production-only-password"},
    )

    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


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


def test_board_requires_authentication(client) -> None:
    assert client.get("/api/board").status_code == 401


def test_first_run_creates_empty_board_with_fixed_columns(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    response = client.get("/api/board")

    assert response.status_code == 200
    assert response.json() == {
        "columns": [
            {"id": column_id, "title": title, "cardIds": []}
            for column_id, _, title, _ in COLUMN_DEFINITIONS
        ],
        "cards": {},
    }


def test_migration_preserves_users_and_seeds_empty_boards(tmp_path) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE)"
        )
        connection.executemany(
            "INSERT INTO users (id, username) VALUES (?, ?)",
            [(7, "user"), (12, "other")],
        )

    create_app(
        database_path=database_path,
        session_secret="test-session-secret",
        static_dir=tmp_path / "static",
    )

    with sqlite3.connect(database_path) as connection:
        users = connection.execute(
            "SELECT id, username FROM users ORDER BY id"
        ).fetchall()
        boards = connection.execute(
            "SELECT user_id FROM boards ORDER BY user_id"
        ).fetchall()
        columns_per_board = connection.execute(
            "SELECT board_id, COUNT(*) FROM board_columns GROUP BY board_id "
            "ORDER BY board_id"
        ).fetchall()
        card_count = connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        schema_version = connection.execute("PRAGMA user_version").fetchone()[0]

    assert users == [(7, "user"), (12, "other")]
    assert boards == [(7,), (12,)]
    assert columns_per_board == [(1, 5), (2, 5)]
    assert card_count == 0
    assert schema_version == 2


def test_card_crud_move_and_column_rename(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    first = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "First", "details": "One"},
    ).json()
    second = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "Second", "details": "Two"},
    ).json()
    first_id = first["columns"][0]["cardIds"][0]
    second_id = second["columns"][0]["cardIds"][1]

    renamed = client.patch(
        "/api/board/columns/col-backlog", json={"title": "Ideas"}
    ).json()
    assert renamed["columns"][0]["title"] == "Ideas"

    moved = client.post(
        f"/api/board/cards/{second_id}/move",
        json={"columnId": "col-discovery", "position": 0},
    ).json()
    assert moved["columns"][0]["cardIds"] == [first_id]
    assert moved["columns"][1]["cardIds"] == [second_id]

    moved = client.post(
        f"/api/board/cards/{first_id}/move",
        json={"columnId": "col-discovery", "position": 0},
    ).json()
    assert moved["columns"][1]["cardIds"] == [first_id, second_id]

    updated = client.patch(
        f"/api/board/cards/{first_id}",
        json={"title": "Updated", "details": "Changed"},
    ).json()
    assert updated["cards"][first_id] == {
        "id": first_id,
        "title": "Updated",
        "details": "Changed",
    }

    deleted = client.delete(f"/api/board/cards/{second_id}").json()
    assert deleted["columns"][1]["cardIds"] == [first_id]
    assert second_id not in deleted["cards"]


def test_concurrent_card_creates_keep_unique_contiguous_positions(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    session = client.cookies.get(SESSION_COOKIE)

    def create_card(index: int) -> int:
        request_client = TestClient(client.app)
        request_client.cookies.set(SESSION_COOKIE, session)
        return request_client.post(
            "/api/board/cards",
            json={
                "columnId": "col-backlog",
                "title": f"Concurrent {index}",
                "details": "",
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=8) as executor:
        statuses = list(executor.map(create_card, range(8)))

    assert statuses == [200] * 8
    with sqlite3.connect(client.app.state.database_path) as connection:
        positions = [
            row[0]
            for row in connection.execute(
                "SELECT position FROM cards WHERE column_id = 'col-backlog' "
                "ORDER BY position"
            )
        ]
    assert positions == list(range(8))


def test_board_data_persists_after_app_restart(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    created = client.post(
        "/api/board/cards",
        json={"columnId": "col-done", "title": "Persist me", "details": ""},
    ).json()
    database_path = client.app.state.database_path
    app = create_app(
        database_path=database_path,
        session_secret="test-session-secret",
        static_dir=database_path.parent / "static",
    )

    restarted_client = TestClient(app)
    restarted_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    assert restarted_client.get("/api/board").json() == created


def test_board_routes_return_errors_for_missing_or_invalid_resources(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    assert client.patch(
        "/api/board/columns/unknown", json={"title": "Name"}
    ).status_code == 404
    assert client.patch(
        "/api/board/columns/col-backlog", json={"title": "  "}
    ).status_code == 422
    assert client.post(
        "/api/board/cards",
        json={"columnId": "unknown", "title": "Card", "details": ""},
    ).status_code == 404
    assert client.patch("/api/board/cards/missing", json={"title": "Card"}).status_code == 404
    assert client.patch("/api/board/cards/missing", json={}).status_code == 422


def test_board_and_chat_reject_oversized_text_and_history(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    assert client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "x" * 201, "details": ""},
    ).status_code == 422
    assert client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "Valid", "details": "x" * 5001},
    ).status_code == 422
    assert client.post(
        "/api/ai/chat",
        json={"question": "x" * 4001},
    ).status_code == 422
    assert client.post(
        "/api/ai/chat",
        json={
            "question": "Help",
            "history": [{"role": "user", "content": "Message"}] * 21,
        },
    ).status_code == 422


def test_board_and_cards_are_isolated_by_authenticated_user(client) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    card_id = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "Private", "details": ""},
    ).json()["columns"][0]["cardIds"][0]
    database_path = client.app.state.database_path
    with sqlite3.connect(database_path) as connection:
        connection.execute("INSERT INTO users (username) VALUES (?)", ("other",))
        connection.execute("INSERT INTO boards (user_id) VALUES (2)")
        board_id = connection.execute(
            "SELECT id FROM boards WHERE user_id = 2"
        ).fetchone()[0]
        connection.executemany(
            "INSERT INTO board_columns (board_id, id, key, title, position) "
            "VALUES (?, ?, ?, ?, ?)",
            [
                (board_id, *column)
                for column in COLUMN_DEFINITIONS
            ],
        )

    other_client = TestClient(client.app)
    signed_value = f"2.{int(time.time()) + SESSION_TTL_SECONDS}"
    signature = hmac.new(
        b"test-session-secret", signed_value.encode(), hashlib.sha256
    ).hexdigest()
    other_client.cookies.set(SESSION_COOKIE, f"{signed_value}.{signature}")

    assert other_client.get("/api/board").json()["cards"] == {}
    assert other_client.patch(
        f"/api/board/cards/{card_id}", json={"title": "Stolen"}
    ).status_code == 404
    assert other_client.delete(f"/api/board/cards/{card_id}").status_code == 404

    client.cookies.clear()
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert client.get("/api/board").json()["cards"][card_id]["title"] == "Private"


def test_ai_chat_sends_board_and_transient_history(client, monkeypatch) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    captured = {}

    def complete(messages):
        captured["messages"] = messages
        return json.dumps({"assistant_text": "Ready.", "operations": []})

    monkeypatch.setattr("app.main.chat_completion", complete)
    response = client.post(
        "/api/ai/chat",
        json={
            "question": "What is on my board?",
            "history": [{"role": "user", "content": "Earlier question"}],
        },
    )

    assert response.status_code == 200
    assert response.json()["assistant_text"] == "Ready."
    messages = captured["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "Earlier question"}
    assert "What is on my board?" in messages[2]["content"]
    assert '"columns"' in messages[2]["content"]
    with sqlite3.connect(client.app.state.database_path) as connection:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert not any("chat" in table_name for table_name in table_names)


def test_ai_chat_requires_approval_before_applying_operations(client, monkeypatch) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    first_id = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "First", "details": "Old"},
    ).json()["columns"][0]["cardIds"][0]
    second_id = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "Second", "details": ""},
    ).json()["columns"][0]["cardIds"][1]
    monkeypatch.setattr(
        "app.main.chat_completion",
        lambda _messages: json.dumps(
            {
                "assistant_text": "Updated the board.",
                "operations": [
                    {
                        "type": "update_card",
                        "card_id": first_id,
                        "title": "Updated first",
                        "details": "New details",
                    },
                    {
                        "type": "move_card",
                        "card_id": first_id,
                        "column_id": "col-review",
                        "position": 0,
                    },
                    {"type": "delete_card", "card_id": second_id},
                    {
                        "type": "create_card",
                        "column_id": "col-backlog",
                        "title": "Created by AI",
                        "details": "New task",
                    },
                    {
                        "type": "rename_column",
                        "column_id": "col-backlog",
                        "title": "Ideas",
                    },
                ],
            }
        ),
    )

    response = client.post("/api/ai/chat", json={"question": "Update these cards"})

    assert response.status_code == 200
    result = response.json()
    assert result["assistant_text"] == "Updated the board."
    assert len(result["operations"]) == 5
    assert client.get("/api/board").json()["cards"][first_id] == {
        "id": first_id,
        "title": "First",
        "details": "Old",
    }

    applied = client.post(
        "/api/ai/apply", json={"operations": result["operations"]}
    )

    assert applied.status_code == 200
    board = applied.json()
    assert board["cards"][first_id] == {
        "id": first_id,
        "title": "Updated first",
        "details": "New details",
    }
    assert second_id not in board["cards"]
    assert board["columns"][0]["title"] == "Ideas"
    assert board["columns"][3]["cardIds"] == [first_id]
    created_id = board["columns"][0]["cardIds"][0]
    assert board["cards"][created_id]["title"] == "Created by AI"


def test_ai_chat_rejects_malformed_or_partial_operations_atomically(
    client, monkeypatch
) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    monkeypatch.setattr("app.main.chat_completion", lambda _messages: "not json")

    malformed = client.post("/api/ai/chat", json={"question": "Add a card"})

    assert malformed.status_code == 502
    assert client.get("/api/board").json()["cards"] == {}

    monkeypatch.setattr(
        "app.main.chat_completion",
        lambda _messages: json.dumps(
            {
                "assistant_text": "I added a card.",
                "operations": [
                    {
                        "type": "create_card",
                        "column_id": "col-backlog",
                        "title": "Must roll back",
                        "details": "",
                    },
                    {"type": "delete_card", "card_id": "missing-card"},
                ],
            }
        ),
    )

    proposal = client.post("/api/ai/chat", json={"question": "Add a card"})

    assert proposal.status_code == 200
    rejected = client.post(
        "/api/ai/apply", json={"operations": proposal.json()["operations"]}
    )
    assert rejected.status_code == 502
    assert client.get("/api/board").json()["cards"] == {}


def test_ai_chat_cannot_mutate_another_users_card(client, monkeypatch) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    card_id = client.post(
        "/api/board/cards",
        json={"columnId": "col-backlog", "title": "Private", "details": ""},
    ).json()["columns"][0]["cardIds"][0]
    database_path = client.app.state.database_path
    with sqlite3.connect(database_path) as connection:
        connection.execute("INSERT INTO users (username) VALUES (?)", ("other",))
        connection.execute("INSERT INTO boards (user_id) VALUES (2)")
        board_id = connection.execute(
            "SELECT id FROM boards WHERE user_id = 2"
        ).fetchone()[0]
        connection.executemany(
            "INSERT INTO board_columns (board_id, id, key, title, position) "
            "VALUES (?, ?, ?, ?, ?)",
            [(board_id, *column) for column in COLUMN_DEFINITIONS],
        )
    other_client = TestClient(client.app)
    signed_value = f"2.{int(time.time()) + SESSION_TTL_SECONDS}"
    signature = hmac.new(
        b"test-session-secret", signed_value.encode(), hashlib.sha256
    ).hexdigest()
    other_client.cookies.set(SESSION_COOKIE, f"{signed_value}.{signature}")
    monkeypatch.setattr(
        "app.main.chat_completion",
        lambda _messages: json.dumps(
            {
                "assistant_text": "Updated.",
                "operations": [
                    {"type": "update_card", "card_id": card_id, "title": "Stolen"}
                ],
            }
        ),
    )

    response = other_client.post("/api/ai/chat", json={"question": "Update this"})

    assert response.status_code == 200
    rejected = other_client.post(
        "/api/ai/apply", json={"operations": response.json()["operations"]}
    )
    assert rejected.status_code == 502
    client.cookies.clear()
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert client.get("/api/board").json()["cards"][card_id]["title"] == "Private"


def test_ai_chat_returns_actionable_provider_errors(client, monkeypatch) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    def missing_key(_messages):
        raise OpenRouterError("OpenRouter is not configured. Set OPENROUTER_API_KEY.")

    monkeypatch.setattr("app.main.chat_completion", missing_key)
    missing = client.post("/api/ai/chat", json={"question": "Help"})
    assert missing.status_code == 503
    assert "OPENROUTER_API_KEY" in missing.json()["detail"]

    def provider_failure(_messages):
        raise OpenRouterError("OpenRouter request failed with HTTP 429.")

    monkeypatch.setattr("app.main.chat_completion", provider_failure)
    failed = client.post("/api/ai/chat", json={"question": "Help"})
    assert failed.status_code == 502
    assert failed.json()["detail"] == "OpenRouter request failed with HTTP 429."


def test_ai_chat_limits_provider_requests_per_minute(client, monkeypatch) -> None:
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    calls = 0

    def complete(_messages):
        nonlocal calls
        calls += 1
        return json.dumps({"assistant_text": "Ready.", "operations": []})

    monkeypatch.setattr("app.main.chat_completion", complete)
    for _ in range(AI_REQUEST_LIMIT):
        assert client.post("/api/ai/chat", json={"question": "Help"}).status_code == 200

    limited = client.post("/api/ai/chat", json={"question": "One more"})

    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
    assert calls == AI_REQUEST_LIMIT


def test_health_route(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_hello_route(client) -> None:
    response = client.get("/api/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello from FastAPI"}
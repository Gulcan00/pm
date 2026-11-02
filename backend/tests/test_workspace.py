import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.accounts import hash_password, verify_password
from app.main import AUTH_REQUEST_LIMIT, SESSION_COOKIE, create_app, initialize_database


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(
        database_path=tmp_path / "workspace.sqlite3",
        session_secret="workspace-test-secret",
        static_dir=tmp_path / "static",
    ))


def register(client, username="alice"):
    response = client.post("/api/auth/register", json={
        "username": username, "password": "a-strong-password",
    })
    assert response.status_code == 201, response.text
    return response.json()


def create_board(client, name="Release"):
    response = client.post("/api/boards", json={"name": name, "description": "Ship it"})
    assert response.status_code == 201, response.text
    return response.json()


def create_card(client, board_id, **fields):
    response = client.post(f"/api/boards/{board_id}/cards", json={
        "columnId": "col-backlog", "title": "Plan launch", **fields,
    })
    assert response.status_code == 200, response.text
    board = response.json()
    return board, board["columns"][0]["cardIds"][-1]


def test_hashes_are_salted_and_verified():
    first, second = hash_password("secret"), hash_password("secret")
    assert first != second
    assert verify_password("secret", first)
    assert not verify_password("wrong", first)
    assert not verify_password("secret", None)


def test_registration_login_and_restart(client, tmp_path):
    identity = register(client, "Alice")
    assert identity["username"] == "alice"
    assert client.get("/api/auth/me").json() == identity
    boards = client.get("/api/boards").json()
    assert len(boards) == 1
    assert boards[0]["cardCount"] == boards[0]["completedCount"] == 0
    assert len(client.get(f"/api/boards/{boards[0]['id']}").json()["columns"]) == 5
    with sqlite3.connect(client.app.state.database_path) as connection:
        stored_hash = connection.execute("SELECT password_hash FROM users WHERE username = 'alice'").fetchone()[0]
    assert verify_password("a-strong-password", stored_hash)
    assert client.post("/api/auth/logout").status_code == 200
    restarted = TestClient(create_app(
        database_path=client.app.state.database_path,
        session_secret="workspace-test-secret", static_dir=tmp_path / "static",
    ))
    assert restarted.post("/api/auth/login", json={"username": "ALICE", "password": "a-strong-password"}).status_code == 200
    assert restarted.get("/api/boards").json() == boards


@pytest.mark.parametrize("username,password", [
    ("ab", "a-strong-password"), ("spaces here", "a-strong-password"),
    ("valid", "short"), ("", "a-strong-password"),
    ("a" * 65, "a-strong-password"), ("valid", "a" * 257),
])
def test_invalid_registration_is_atomic(client, username, password):
    assert client.post("/api/auth/register", json={"username": username, "password": password}).status_code == 422
    with sqlite3.connect(client.app.state.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1


def test_duplicate_registration_and_missing_login(client):
    register(client)
    assert client.post("/api/auth/register", json={"username": "ALICE", "password": "different-password"}).status_code == 409
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": "nobody", "password": "a-strong-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_password_change_revokes_old_sessions_and_logout_revokes_replay(client):
    register(client)
    old_token = client.cookies.get(SESSION_COOKIE)
    other = TestClient(client.app)
    other.cookies.set(SESSION_COOKIE, old_token)
    assert other.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/password", json={"current_password": "wrong", "new_password": "replacement-password"}).status_code == 403
    assert client.post("/api/auth/password", json={"current_password": "a-strong-password", "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/password", json={"current_password": "a-strong-password", "new_password": "replacement-password"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    token = client.cookies.get(SESSION_COOKIE)
    assert client.post("/api/auth/logout").status_code == 200
    other.cookies.set(SESSION_COOKIE, token)
    assert other.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": "alice", "password": "a-strong-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "alice", "password": "replacement-password"}).status_code == 200


def test_account_delete_cascades_and_preserves_other_users(client):
    register(client)
    board = create_board(client)
    create_card(client, board["id"])
    token = client.cookies.get(SESSION_COOKIE)
    other = TestClient(client.app)
    register(other, "bob")
    assert client.request("DELETE", "/api/auth/account", json={"username": "alice", "password": "wrong"}).status_code == 403
    assert client.request("DELETE", "/api/auth/account", json={"username": "bob", "password": "a-strong-password"}).status_code == 403
    assert client.request("DELETE", "/api/auth/account", json={"username": "alice", "password": "a-strong-password"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    replay = TestClient(client.app)
    replay.cookies.set(SESSION_COOKIE, token)
    assert replay.get("/api/auth/me").status_code == 401
    with sqlite3.connect(client.app.state.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 2
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    assert other.get("/api/auth/me").json()["username"] == "bob"
    register(client, "charlie")
    assert replay.get("/api/auth/me").status_code == 401


def test_account_attempts_are_throttled(client):
    for _ in range(AUTH_REQUEST_LIMIT):
        assert client.post("/api/auth/login", json={"username": "user", "password": "wrong"}).status_code == 401
    response = client.post("/api/auth/register", json={"username": "alice", "password": "a-strong-password"})
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0


def test_production_refuses_a_preexisting_default_password(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MVP_PASSWORD", "configured-bootstrap-password")
    with pytest.raises(RuntimeError, match="Change the default user's password"):
        create_app(database_path=client.app.state.database_path, session_secret="s" * 40)


def test_board_crud_metadata_counts_and_last_board_deletion(client):
    register(client)
    initial = client.get("/api/boards").json()[0]
    board = create_board(client, "  Launch  ")
    assert board["name"] == "Launch"
    assert board["description"] == "Ship it"
    updated = client.patch(f"/api/boards/{board['id']}", json={"name": "Release", "description": "Ready"}).json()
    assert updated["name"] == "Release"
    with_card, card_id = create_card(client, board["id"], priority="urgent", dueDate="2026-01-02")
    assert with_card["cards"][card_id]["priority"] == "urgent"
    assert with_card["cards"][card_id]["dueDate"] == "2026-01-02"
    assert client.get(f"/api/boards/{initial['id']}").json()["cards"] == {}
    assert client.get("/api/board").json()["id"] == initial["id"]
    moved = client.post(f"/api/boards/{board['id']}/cards/{card_id}/move", json={"columnId": "col-done", "position": 0})
    assert moved.status_code == 200
    summary = client.get("/api/boards").json()[1]
    assert summary == {"id": board["id"], "name": "Release", "description": "Ready", "cardCount": 1, "completedCount": 1}
    cleared = client.patch(f"/api/boards/{board['id']}/cards/{card_id}", json={"priority": "low", "dueDate": None}).json()
    assert cleared["cards"][card_id]["dueDate"] is None
    assert cleared["cards"][card_id]["priority"] == "low"
    assert client.patch(f"/api/boards/{board['id']}/columns/col-backlog", json={"title": "Ideas"}).status_code == 200
    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert client.get(f"/api/boards/{board['id']}").status_code == 404
    assert client.delete(f"/api/boards/{initial['id']}").status_code == 204
    assert client.get("/api/boards").json() == []
    assert client.get("/api/board").status_code == 404
    assert create_board(client)["cards"] == {}
    with sqlite3.connect(client.app.state.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("method,suffix,payload", [
    ("GET", "", None), ("PATCH", "", {"name": "Stolen"}), ("DELETE", "", None),
    ("POST", "/cards", {"columnId": "col-backlog", "title": "No"}),
    ("PATCH", "/columns/col-backlog", {"title": "No"}),
    ("PATCH", "/cards/private", {"title": "No"}),
    ("DELETE", "/cards/private", None),
    ("POST", "/cards/private/move", {"columnId": "col-done", "position": 0}),
    ("POST", "/ai/chat", {"question": "Help"}),
    ("POST", "/ai/apply", {"operations": [{"type": "rename_column", "column_id": "col-backlog", "title": "No"}]}),
])
def test_all_board_surfaces_enforce_ownership(client, method, suffix, payload):
    register(client)
    board = create_board(client)
    stranger = TestClient(client.app)
    register(stranger, "bob")
    response = stranger.request(method, f"/api/boards/{board['id']}{suffix}", json=payload)
    assert response.status_code == 404
    anonymous = TestClient(client.app)
    assert anonymous.request(method, f"/api/boards/{board['id']}{suffix}", json=payload).status_code == 401
    assert client.get(f"/api/boards/{board['id']}").json() == board


@pytest.mark.parametrize("payload", [
    {"name": " "}, {"name": ""}, {"name": "a" * 101},
    {"name": "Valid", "description": "x" * 2001},
])
def test_invalid_board_details(client, payload):
    register(client)
    board_id = client.get("/api/boards").json()[0]["id"]
    assert client.post("/api/boards", json=payload).status_code == 422
    assert client.patch(f"/api/boards/{board_id}", json=payload).status_code == 422


@pytest.mark.parametrize("fields", [
    {"priority": "invalid"}, {"priority": None}, {"dueDate": "2026-02-30"},
    {"title": None}, {"details": None}, {},
])
def test_invalid_task_updates_are_atomic(client, fields):
    register(client)
    board_id = client.get("/api/boards").json()[0]["id"]
    board, card_id = create_card(client, board_id)
    assert client.patch(f"/api/boards/{board_id}/cards/{card_id}", json=fields).status_code == 422
    assert client.get(f"/api/boards/{board_id}").json() == board


def test_assistant_is_scoped_and_preserves_unspecified_task_metadata(client, monkeypatch):
    register(client)
    board = create_board(client)
    before, card_id = create_card(client, board["id"], priority="urgent", dueDate="2026-12-31")
    captured = []
    def complete(messages):
        captured.extend(messages)
        return json.dumps({"assistant_text": "Proposed.", "operations": [
            {"type": "update_card", "card_id": card_id, "title": "Renamed"},
        ]})
    monkeypatch.setattr("app.main.chat_completion", complete)
    proposal = client.post(f"/api/boards/{board['id']}/ai/chat", json={"question": "Rename"})
    assert proposal.status_code == 200
    assert "Plan launch" in captured[-1]["content"]
    assert client.get(f"/api/boards/{board['id']}").json() == before
    operations = proposal.json()["operations"]
    assert "due_date" not in operations[0]
    applied = client.post(f"/api/boards/{board['id']}/ai/apply", json={"operations": operations}).json()
    assert applied["cards"][card_id]["priority"] == "urgent"
    assert applied["cards"][card_id]["dueDate"] == "2026-12-31"
    assert applied["cards"][card_id]["title"] == "Renamed"
    cleared = client.post(f"/api/boards/{board['id']}/ai/apply", json={"operations": [
        {"type": "update_card", "card_id": card_id, "priority": "high", "due_date": None},
        {"type": "create_card", "column_id": "col-review", "title": "Review", "priority": "low", "due_date": "2026-12-12"},
    ]})
    assert cleared.status_code == 200
    assert cleared.json()["cards"][card_id]["dueDate"] is None
    first_board = client.get("/api/boards").json()[0]["id"]
    assert client.post(f"/api/boards/{first_board}/ai/apply", json={"operations": operations}).status_code == 502


def test_v2_migration_preserves_cards_and_restarts(tmp_path):
    path = tmp_path / "v2.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL);
            INSERT INTO users VALUES (7, 'user');
            CREATE TABLE boards (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id));
            INSERT INTO boards VALUES (13, 7);
            CREATE TABLE board_columns (board_id INTEGER REFERENCES boards(id), id TEXT, key TEXT, title TEXT, position INTEGER, PRIMARY KEY(board_id, id));
            INSERT INTO board_columns VALUES (13, 'col-backlog', 'backlog', 'Original', 0);
            CREATE TABLE cards (id TEXT PRIMARY KEY, board_id INTEGER, column_id TEXT, title TEXT, details TEXT, position INTEGER, FOREIGN KEY(board_id,column_id) REFERENCES board_columns(board_id,id));
            INSERT INTO cards VALUES ('old-card', 13, 'col-backlog', 'Keep me', 'Details', 0);
            PRAGMA user_version = 2;
        """)
    initialize_database(path)
    initialize_database(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 4
        assert connection.execute("SELECT title, priority, due_date FROM cards").fetchone() == ("Keep me", "medium", None)
        assert connection.execute("SELECT title FROM board_columns").fetchone() == ("Original",)
        connection.execute("INSERT INTO boards (user_id) VALUES (7)")
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_concurrent_initialization_and_newer_schema(tmp_path):
    path = tmp_path / "concurrent.sqlite3"
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(initialize_database, [path] * 4))
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1
        connection.execute("PRAGMA user_version = 999")
    with pytest.raises(RuntimeError, match="newer than supported"):
        initialize_database(path)


def test_postgres_adapter_transaction_boundaries(monkeypatch):
    from app.main import database_connection
    raw = MagicMock()
    monkeypatch.setattr("app.main.psycopg.connect", lambda url: raw)
    with database_connection("postgres://local", immediate=True) as connection:
        connection.execute("SELECT ? + ?", (1, 2))
        connection.executemany("SELECT ?", [(1,), (2,)])
    raw.execute.assert_any_call("SELECT pg_advisory_xact_lock(1398031694)", ())
    raw.execute.assert_any_call("SELECT %s + %s", (1, 2))
    raw.cursor.return_value.executemany.assert_called_once_with("SELECT %s", [(1,), (2,)])
    raw.commit.assert_called_once()
    raw.close.assert_called_once()
    raw.reset_mock()
    with pytest.raises(ValueError):
        with database_connection("postgresql://local"):
            raise ValueError("transaction failed")
    raw.rollback.assert_called_once()
    raw.close.assert_called_once()

import os
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured")
def test_postgres_workspace_integration(tmp_path, monkeypatch):
    """Run against a disposable schema, never an application's existing tables."""
    url = os.environ["TEST_DATABASE_URL"]
    schema = f"kanban_test_{uuid.uuid4().hex}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            monkeypatch.setenv("DATABASE_URL", make_conninfo(url, options=f"-csearch_path={schema}"))
            app = create_app(session_secret="postgres-integration-secret", static_dir=tmp_path)
            alice, bob = TestClient(app), TestClient(app)
            for client, username in [(alice, "alice"), (bob, "bob")]:
                assert client.post("/api/auth/register", json={"username": username, "password": "integration-password"}).status_code == 201
            board = alice.post("/api/boards", json={"name": "Postgres project"}).json()
            board_id = board["id"]
            created = alice.post(f"/api/boards/{board_id}/cards", json={
                "columnId": "col-backlog", "title": "Persist in PostgreSQL", "priority": "high", "dueDate": "2026-12-31",
            })
            assert created.status_code == 200
            card_id = created.json()["columns"][0]["cardIds"][0]
            assert bob.get(f"/api/boards/{board_id}").status_code == 404
            assert alice.post(f"/api/boards/{board_id}/cards/{card_id}/move", json={"columnId": "col-done", "position": 0}).status_code == 200
            restarted = TestClient(create_app(session_secret="postgres-integration-secret", static_dir=tmp_path))
            assert restarted.post("/api/auth/login", json={"username": "alice", "password": "integration-password"}).status_code == 200
            persisted = restarted.get(f"/api/boards/{board_id}").json()
            assert persisted["cards"][card_id]["dueDate"] == "2026-12-31"
            assert persisted["columns"][4]["cardIds"] == [card_id]
            assert restarted.delete(f"/api/boards/{board_id}").status_code == 204
            assert restarted.get(f"/api/boards/{board_id}").status_code == 404
            assert restarted.request("DELETE", "/api/auth/account", json={"username": "alice", "password": "integration-password"}).status_code == 200
            assert bob.get("/api/auth/me").json()["username"] == "bob"
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))

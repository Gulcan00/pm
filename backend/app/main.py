from contextlib import contextmanager
from collections import deque
from datetime import date
import hashlib
import hmac
import os
import sqlite3
from threading import Lock
import time
import uuid
from pathlib import Path
from typing import Any, Iterator, Literal, Sequence

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
import psycopg
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.accounts import hash_password, verify_password

from app.assistant import (
    AIApplyRequest,
    AIChatRequest,
    AssistantResponse,
    CreateCardOperation,
    DeleteCardOperation,
    MoveCardOperation,
    RenameColumnOperation,
    UpdateCardOperation,
    build_model_messages,
)
from app.openrouter import OpenRouterError, chat_completion

MVP_USERNAME = "user"
MVP_PASSWORD = "password"
SESSION_COOKIE = "kanban_session"
SESSION_TTL_SECONDS = 60 * 60 * 24
AI_REQUEST_LIMIT = 10
AI_REQUEST_WINDOW_SECONDS = 60
AUTH_REQUEST_LIMIT = 60
AUTH_REQUEST_WINDOW_SECONDS = 60
SCHEMA_VERSION = 4
COLUMN_DEFINITIONS = (
    ("col-backlog", "backlog", "Backlog", 0),
    ("col-discovery", "discovery", "Discovery", 1),
    ("col-progress", "progress", "In Progress", 2),
    ("col-review", "review", "Review", 3),
    ("col-done", "done", "Done", 4),
)


class LoginCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class Registration(LoginCredentials):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=12, max_length=256)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.lower()


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class BoardDetails(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)


class RenameColumn(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class CreateCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    column_id: str = Field(alias="columnId", min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    details: str = Field(default="", max_length=5000)
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    due_date: date | None = Field(default=None, alias="dueDate")


class UpdateCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=5000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    due_date: date | None = Field(default=None, alias="dueDate")


class MoveCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    column_id: str = Field(alias="columnId", min_length=1, max_length=100)
    position: int = Field(ge=0)


@contextmanager
def database_connection(
    database_target: Path | str, immediate: bool = False
) -> Iterator[Any]:
    if isinstance(database_target, str):
        database_url = database_target.replace("postgres://", "postgresql://", 1)
        connection = PostgresConnection(psycopg.connect(database_url))
        try:
            if immediate:
                connection.execute("SELECT pg_advisory_xact_lock(1398031694)")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return

    connection = sqlite3.connect(database_target, timeout=30)
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        if immediate:
            connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class PostgresConnection:
    def __init__(self, connection: psycopg.Connection) -> None:
        self.connection = connection

    def execute(self, query: str, parameters: Sequence[object] = ()) -> Any:
        return self.connection.execute(query.replace("?", "%s"), parameters)

    def executemany(
        self, query: str, parameters: Sequence[Sequence[object]]
    ) -> None:
        self.connection.cursor().executemany(
            query.replace("?", "%s"), parameters
        )

    def commit(self) -> None:
        self.connection.commit()

    def rollback(self) -> None:
        self.connection.rollback()

    def close(self) -> None:
        self.connection.close()


def migrate_workspace(connection: Any, postgres: bool) -> None:
    connection.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
    connection.execute(
        "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0"
    )
    connection.execute(
        "UPDATE users SET password_hash = ? WHERE username = ?",
        (hash_password(os.environ.get("MVP_PASSWORD") or MVP_PASSWORD), MVP_USERNAME),
    )
    if postgres:
        connection.execute("ALTER TABLE boards DROP CONSTRAINT boards_user_id_key")
        connection.execute(
            "ALTER TABLE boards ADD COLUMN name TEXT NOT NULL DEFAULT 'My project'"
        )
        connection.execute(
            "ALTER TABLE boards ADD COLUMN description TEXT NOT NULL DEFAULT ''"
        )
    else:
        # Rebuild with foreign keys disabled to remove SQLite's implicit unique index.
        connection.execute(
            "CREATE TABLE boards_new (id INTEGER PRIMARY KEY, "
            "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "name TEXT NOT NULL DEFAULT 'My project', "
            "description TEXT NOT NULL DEFAULT '')"
        )
        connection.execute(
            "INSERT INTO boards_new (id, user_id) SELECT id, user_id FROM boards"
        )
        connection.execute("DROP TABLE boards")
        connection.execute("ALTER TABLE boards_new RENAME TO boards")
    connection.execute("CREATE INDEX boards_owner ON boards(user_id, id)")
    connection.execute(
        "ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' "
        "CHECK(priority IN ('low', 'medium', 'high', 'urgent'))"
    )
    connection.execute("ALTER TABLE cards ADD COLUMN due_date TEXT")
    if postgres:
        connection.execute("UPDATE app_schema_version SET version = 3 WHERE id = TRUE")
    else:
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError("Workspace migration would leave invalid foreign keys")
        connection.execute("PRAGMA user_version = 3")


def initialize_postgres_database(database_url: str) -> None:
    database_url = database_url.replace("postgres://", "postgresql://", 1)
    with database_connection(database_url, immediate=True) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS app_schema_version ("
            "id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id IS TRUE), "
            "version INTEGER NOT NULL)"
        )
        connection.execute(
            "INSERT INTO app_schema_version (id, version) VALUES (TRUE, 0) "
            "ON CONFLICT (id) DO NOTHING"
        )
        version = connection.execute(
            "SELECT version FROM app_schema_version WHERE id = TRUE FOR UPDATE"
        ).fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema version {version} is newer than supported version {SCHEMA_VERSION}"
            )

        if version < 1:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS users ("
                "id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "
                "username TEXT NOT NULL UNIQUE)"
            )
            connection.execute(
                "INSERT INTO users (username) VALUES (?) "
                "ON CONFLICT (username) DO NOTHING",
                (MVP_USERNAME,),
            )
            connection.execute(
                "UPDATE app_schema_version SET version = 1 WHERE id = TRUE"
            )
            version = 1

        if version < 2:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS boards ("
                "id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "
                "user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS board_columns ("
                "board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, "
                "id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, "
                "position INTEGER NOT NULL CHECK(position >= 0), "
                "PRIMARY KEY(board_id, id), UNIQUE(board_id, key), "
                "UNIQUE(board_id, position), "
                "CHECK(length(trim(title)) > 0), "
                "CHECK((id = 'col-backlog' AND key = 'backlog' AND position = 0) OR "
                "(id = 'col-discovery' AND key = 'discovery' AND position = 1) OR "
                "(id = 'col-progress' AND key = 'progress' AND position = 2) OR "
                "(id = 'col-review' AND key = 'review' AND position = 3) OR "
                "(id = 'col-done' AND key = 'done' AND position = 4)))"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS cards ("
                "id TEXT PRIMARY KEY, board_id BIGINT NOT NULL, "
                "column_id TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL, "
                "position INTEGER NOT NULL CHECK(position >= 0), "
                "CHECK(length(trim(title)) > 0), "
                "UNIQUE(board_id, column_id, position), "
                "FOREIGN KEY(board_id, column_id) "
                "REFERENCES board_columns(board_id, id) ON DELETE CASCADE)"
            )
            for (user_id,) in connection.execute("SELECT id FROM users").fetchall():
                connection.execute(
                    "INSERT INTO boards (user_id) VALUES (?) "
                    "ON CONFLICT (user_id) DO NOTHING",
                    (user_id,),
                )
                board_id = connection.execute(
                    "SELECT id FROM boards WHERE user_id = ?", (user_id,)
                ).fetchone()[0]
                connection.executemany(
                    "INSERT INTO board_columns (board_id, id, key, title, position) "
                    "VALUES (?, ?, ?, ?, ?) ON CONFLICT (board_id, id) DO NOTHING",
                    [
                        (board_id, column_id, key, title, position)
                        for column_id, key, title, position in COLUMN_DEFINITIONS
                    ],
                )
            connection.execute(
                "UPDATE app_schema_version SET version = 2 WHERE id = TRUE"
            )
        if version < 3:
            migrate_workspace(connection, postgres=True)
        if version < 4:
            connection.execute("UPDATE app_schema_version SET version = 4 WHERE id = TRUE")


def initialize_database(database_target: Path | str) -> None:
    if isinstance(database_target, str):
        initialize_postgres_database(database_target)
        return

    database_path = database_target
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with database_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema version {version} is newer than supported version {SCHEMA_VERSION}"
            )

        if version < 1:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS users ("
                "id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE)"
            )
            connection.execute(
                "INSERT OR IGNORE INTO users (username) VALUES (?)",
                (MVP_USERNAME,),
            )
            connection.execute("PRAGMA user_version = 1")

        if version < 2:
            connection.execute(
                "CREATE TABLE boards ("
                "id INTEGER PRIMARY KEY, "
                "user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE)"
            )
            connection.execute(
                "CREATE TABLE board_columns ("
                "board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE, "
                "id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, "
                "position INTEGER NOT NULL CHECK(position >= 0), "
                "PRIMARY KEY(board_id, id), UNIQUE(board_id, key), "
                "UNIQUE(board_id, position), "
                "CHECK(length(trim(title)) > 0), "
                "CHECK((id = 'col-backlog' AND key = 'backlog' AND position = 0) OR "
                "(id = 'col-discovery' AND key = 'discovery' AND position = 1) OR "
                "(id = 'col-progress' AND key = 'progress' AND position = 2) OR "
                "(id = 'col-review' AND key = 'review' AND position = 3) OR "
                "(id = 'col-done' AND key = 'done' AND position = 4)))"
            )
            connection.execute(
                "CREATE TABLE cards ("
                "id TEXT PRIMARY KEY, board_id INTEGER NOT NULL, "
                "column_id TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL, "
                "position INTEGER NOT NULL CHECK(position >= 0), "
                "CHECK(length(trim(title)) > 0), "
                "UNIQUE(board_id, column_id, position), "
                "FOREIGN KEY(board_id, column_id) "
                "REFERENCES board_columns(board_id, id) ON DELETE CASCADE)"
            )
            user_ids = connection.execute("SELECT id FROM users").fetchall()
            for (user_id,) in user_ids:
                connection.execute(
                    "INSERT INTO boards (user_id) VALUES (?)", (user_id,)
                )
                board_id = connection.execute(
                    "SELECT id FROM boards WHERE user_id = ?", (user_id,)
                ).fetchone()[0]
                connection.executemany(
                    "INSERT INTO board_columns (board_id, id, key, title, position) "
                    "VALUES (?, ?, ?, ?, ?)",
                    [
                        (board_id, column_id, key, title, position)
                        for column_id, key, title, position in COLUMN_DEFINITIONS
                    ],
                )
            connection.execute("PRAGMA user_version = 2")
        if version < 3:
            migrate_workspace(connection, postgres=False)
        if version < 4:
            # Never reuse deleted identity/resource IDs, including while sessions are still valid.
            connection.execute(
                "CREATE TABLE users_new (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "username TEXT NOT NULL UNIQUE, password_hash TEXT, "
                "session_version INTEGER NOT NULL DEFAULT 0)"
            )
            connection.execute(
                "INSERT INTO users_new SELECT id, username, password_hash, session_version FROM users"
            )
            connection.execute("DROP TABLE users")
            connection.execute("ALTER TABLE users_new RENAME TO users")
            connection.execute(
                "CREATE TABLE boards_new (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "name TEXT NOT NULL DEFAULT 'My project', description TEXT NOT NULL DEFAULT '')"
            )
            connection.execute("INSERT INTO boards_new SELECT id, user_id, name, description FROM boards")
            connection.execute("DROP TABLE boards")
            connection.execute("ALTER TABLE boards_new RENAME TO boards")
            connection.execute("CREATE INDEX boards_owner ON boards(user_id, id)")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Identity migration would leave invalid foreign keys")
            connection.execute("PRAGMA user_version = 4")


def create_app(
    database_path: Path | None = None,
    session_secret: str | None = None,
    static_dir: Path | None = None,
) -> FastAPI:
    if database_path is not None:
        resolved_database_path: Path | str = database_path
    elif database_url := os.environ.get("DATABASE_URL"):
        resolved_database_path = database_url
    else:
        resolved_database_path = Path(
            os.environ.get(
                "DATABASE_PATH",
                str(Path(__file__).resolve().parents[1] / "data" / "kanban.sqlite3"),
            )
        )
    runtime_environment = os.environ.get("APP_ENV", "development").lower()
    if runtime_environment not in {"development", "production"}:
        raise RuntimeError("APP_ENV must be development or production")
    configured_secret = session_secret or os.environ.get("SESSION_SECRET")
    configured_password = os.environ.get("MVP_PASSWORD")
    if runtime_environment == "production":
        if not configured_secret or len(configured_secret) < 32:
            raise RuntimeError("Production requires a SESSION_SECRET of at least 32 characters")
        if not configured_password or len(configured_password) < 12 or configured_password == MVP_PASSWORD:
            raise RuntimeError("Production requires an MVP_PASSWORD of at least 12 non-default characters")
    resolved_secret = configured_secret or "local-development-session-secret"
    initialize_database(resolved_database_path)
    if runtime_environment == "production":
        with database_connection(resolved_database_path) as connection:
            seed = connection.execute(
                "SELECT password_hash FROM users WHERE username = ?", (MVP_USERNAME,)
            ).fetchone()
        if seed and verify_password(MVP_PASSWORD, seed[0]):
            raise RuntimeError(
                "Change the default user's password in account settings before using this database in production"
            )

    app = FastAPI(title="Kanban API")
    app.state.database_path = resolved_database_path
    ai_request_times: deque[float] = deque()
    ai_request_lock = Lock()
    auth_request_times: deque[float] = deque()
    auth_request_lock = Lock()
    dummy_password_hash = hash_password(uuid.uuid4().hex)

    def enforce_auth_request_limit() -> None:
        now = time.monotonic()
        with auth_request_lock:
            while auth_request_times and auth_request_times[0] <= now - AUTH_REQUEST_WINDOW_SECONDS:
                auth_request_times.popleft()
            if len(auth_request_times) >= AUTH_REQUEST_LIMIT:
                raise HTTPException(
                    status_code=429,
                    detail="Too many account attempts. Try again shortly.",
                    headers={"Retry-After": str(AUTH_REQUEST_WINDOW_SECONDS)},
                )
            auth_request_times.append(now)

    def enforce_ai_request_limit() -> None:
        now = time.monotonic()
        cutoff = now - AI_REQUEST_WINDOW_SECONDS
        with ai_request_lock:
            while ai_request_times and ai_request_times[0] <= cutoff:
                ai_request_times.popleft()
            if len(ai_request_times) >= AI_REQUEST_LIMIT:
                raise HTTPException(
                    status_code=429,
                    detail="Assistant request limit reached. Try again shortly.",
                    headers={"Retry-After": str(AI_REQUEST_WINDOW_SECONDS)},
                )
            ai_request_times.append(now)

    def user_for_id(user_id: str, session_version: int) -> dict[str, int | str]:
        try:
            database_user_id = int(user_id)
        except ValueError:
            raise HTTPException(status_code=401, detail="Not authenticated") from None
        with database_connection(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username, session_version FROM users WHERE id = ?", (database_user_id,)
            ).fetchone()
        if row is None or row[2] != session_version:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {"id": row[0], "username": row[1]}

    def current_user(request: Request) -> dict[str, int | str]:
        token = request.cookies.get(SESSION_COOKIE, "")
        try:
            user_id, version_text, expires_at_text, signature = token.split(".", 3)
            expires_at = int(expires_at_text)
            session_version = int(version_text)
        except ValueError:
            raise HTTPException(status_code=401, detail="Not authenticated") from None
        signed_value = f"{user_id}.{version_text}.{expires_at_text}"
        expected_signature = hmac.new(
            resolved_secret.encode(), signed_value.encode(), hashlib.sha256
        ).hexdigest()
        if (
            not user_id
            or expires_at <= time.time()
            or not hmac.compare_digest(signature, expected_signature)
        ):
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user_for_id(user_id, session_version)

    def set_session(response: Response, user_id: int, version: int) -> None:
        expires_at = int(time.time()) + SESSION_TTL_SECONDS
        signed_value = f"{user_id}.{version}.{expires_at}"
        signature = hmac.new(
            resolved_secret.encode(), signed_value.encode(), hashlib.sha256
        ).hexdigest()
        response.set_cookie(
            SESSION_COOKIE,
            f"{signed_value}.{signature}",
            httponly=True,
            secure=runtime_environment == "production",
            samesite="lax",
            path="/",
            max_age=SESSION_TTL_SECONDS,
        )

    def insert_board(connection: Any, user_id: int, name: str, description: str = "") -> int:
        board_id = connection.execute(
            "INSERT INTO boards (user_id, name, description) VALUES (?, ?, ?) RETURNING id",
            (user_id, name, description),
        ).fetchone()[0]
        connection.executemany(
            "INSERT INTO board_columns (board_id, id, key, title, position) VALUES (?, ?, ?, ?, ?)",
            [(board_id, *column) for column in COLUMN_DEFINITIONS],
        )
        return board_id

    @app.post("/api/auth/register", status_code=201)
    def register(payload: Registration, response: Response) -> dict[str, int | str]:
        enforce_auth_request_limit()
        password_hash = hash_password(payload.password)
        try:
            with database_connection(resolved_database_path, immediate=True) as connection:
                user_id = connection.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id",
                    (payload.username, password_hash),
                ).fetchone()[0]
                insert_board(connection, user_id, "My project")
        except (sqlite3.IntegrityError, psycopg.errors.UniqueViolation):
            raise HTTPException(status_code=409, detail="Username is already taken") from None
        set_session(response, user_id, 0)
        return {"id": user_id, "username": payload.username}

    @app.post("/api/auth/login")
    def login(credentials: LoginCredentials, response: Response) -> dict[str, int | str]:
        enforce_auth_request_limit()
        with database_connection(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username, password_hash, session_version FROM users WHERE username = ?",
                (credentials.username.lower(),),
            ).fetchone()
        password_valid = verify_password(
            credentials.password, row[2] if row and row[2] else dummy_password_hash
        )
        if row is None or row[2] is None or not password_valid:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        set_session(response, row[0], row[3])
        return {"id": row[0], "username": row[1]}

    @app.post("/api/auth/password")
    def change_password(payload: PasswordChange, request: Request, response: Response) -> dict[str, str]:
        user = current_user(request)
        enforce_auth_request_limit()
        with database_connection(resolved_database_path, immediate=True) as connection:
            row = connection.execute(
                "SELECT password_hash, session_version FROM users WHERE id = ?", (user["id"],)
            ).fetchone()
            if not verify_password(payload.current_password, row[0]):
                raise HTTPException(status_code=403, detail="Current password is incorrect")
            connection.execute(
                "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
                (hash_password(payload.new_password), user["id"]),
            )
        set_session(response, int(user["id"]), row[1] + 1)
        return {"status": "ok"}

    @app.delete("/api/auth/account")
    def delete_account(payload: LoginCredentials, request: Request, response: Response) -> dict[str, str]:
        user = current_user(request)
        enforce_auth_request_limit()
        with database_connection(resolved_database_path, immediate=True) as connection:
            row = connection.execute(
                "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
            ).fetchone()
            if payload.username.lower() != user["username"] or not verify_password(payload.password, row[0]):
                raise HTTPException(status_code=403, detail="Account credentials are incorrect")
            connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
        response.delete_cookie(SESSION_COOKIE, path="/", secure=runtime_environment == "production", httponly=True, samesite="lax")
        return {"status": "ok"}

    @app.get("/api/auth/me")
    def me(request: Request) -> dict[str, int | str]:
        return current_user(request)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict[str, str]:
        if request.cookies.get(SESSION_COOKIE):
            user = current_user(request)
            with database_connection(resolved_database_path, immediate=True) as connection:
                connection.execute(
                    "UPDATE users SET session_version = session_version + 1 WHERE id = ?",
                    (user["id"],),
                )
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=runtime_environment == "production",
            httponly=True,
            samesite="lax",
        )
        return {"status": "ok"}

    def board_id_for_user(connection: Any, user_id: int, board_id: int | None = None) -> int:
        if board_id is None:
            row = connection.execute(
                "SELECT id FROM boards WHERE user_id = ? ORDER BY id LIMIT 1", (user_id,)
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT id FROM boards WHERE user_id = ? AND id = ?", (user_id, board_id)
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return row[0]

    def board_data_for_user(user_id: int, selected_board_id: int | None = None) -> dict[str, object]:
        with database_connection(resolved_database_path) as connection:
            board_id = board_id_for_user(connection, user_id, selected_board_id)
            name, description = connection.execute(
                "SELECT name, description FROM boards WHERE id = ?", (board_id,)
            ).fetchone()
            column_rows = connection.execute(
                "SELECT id, title FROM board_columns WHERE board_id = ? "
                "ORDER BY position",
                (board_id,),
            ).fetchall()
            columns = [
                {"id": column_id, "title": title, "cardIds": []}
                for column_id, title in column_rows
            ]
            columns_by_id = {column["id"]: column for column in columns}
            card_rows = connection.execute(
                "SELECT id, column_id, title, details, priority, due_date FROM cards "
                "WHERE board_id = ? "
                "ORDER BY column_id, position",
                (board_id,),
            ).fetchall()
            cards = {}
            for card_id, column_id, title, details, priority, due_date in card_rows:
                cards[card_id] = {
                    "id": card_id,
                    "title": title,
                    "details": details,
                    "priority": priority,
                    "dueDate": due_date,
                }
                columns_by_id[column_id]["cardIds"].append(card_id)
            return {"id": board_id, "name": name, "description": description, "columns": columns, "cards": cards}

    @app.get("/api/boards")
    def list_boards(request: Request) -> list[dict[str, object]]:
        user = current_user(request)
        with database_connection(resolved_database_path) as connection:
            rows = connection.execute(
                "SELECT b.id, b.name, b.description, COUNT(c.id), "
                "COALESCE(SUM(CASE WHEN c.column_id = 'col-done' THEN 1 ELSE 0 END), 0) "
                "FROM boards b LEFT JOIN cards c ON c.board_id = b.id "
                "WHERE b.user_id = ? GROUP BY b.id, b.name, b.description ORDER BY b.id",
                (user["id"],),
            ).fetchall()
        return [
            {"id": row[0], "name": row[1], "description": row[2], "cardCount": row[3], "completedCount": row[4]}
            for row in rows
        ]

    @app.post("/api/boards", status_code=201)
    def create_board(payload: BoardDetails, request: Request) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = insert_board(connection, int(user["id"]), normalized_title(payload.name), payload.description)
        return board_data_for_user(int(user["id"]), board_id)

    @app.patch("/api/boards/{board_id}")
    def update_board(board_id: int, payload: BoardDetails, request: Request) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id_for_user(connection, int(user["id"]), board_id)
            connection.execute(
                "UPDATE boards SET name = ?, description = ? WHERE id = ?",
                (normalized_title(payload.name), payload.description, board_id),
            )
        return board_data_for_user(int(user["id"]), board_id)

    @app.delete("/api/boards/{board_id}", status_code=204)
    def delete_board(board_id: int, request: Request) -> Response:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id_for_user(connection, int(user["id"]), board_id)
            connection.execute("DELETE FROM boards WHERE id = ?", (board_id,))
        return Response(status_code=204)

    def normalized_title(title: str) -> str:
        title = title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Title must not be empty")
        return title

    def write_card_order(
        connection: Any,
        board_id: int,
        orders: dict[str, list[str]],
    ) -> None:
        column_ids = list(orders)
        placeholders = ", ".join("?" for _ in column_ids)
        max_position = connection.execute(
            f"SELECT COALESCE(MAX(position), -1) FROM cards "
            f"WHERE board_id = ? AND column_id IN ({placeholders})",
            [board_id, *column_ids],
        ).fetchone()[0]
        offset = max_position + sum(len(card_ids) for card_ids in orders.values()) + 1
        connection.execute(
            f"UPDATE cards SET position = position + ? "
            f"WHERE board_id = ? AND column_id IN ({placeholders})",
            [offset, board_id, *column_ids],
        )
        for column_id, card_ids in orders.items():
            connection.executemany(
                "UPDATE cards SET column_id = ?, position = ? "
                "WHERE id = ? AND board_id = ?",
                [
                    (column_id, position, card_id, board_id)
                    for position, card_id in enumerate(card_ids)
                ],
            )

    def apply_assistant_operations(
        connection: Any,
        board_id: int,
        operations: list[object],
    ) -> None:
        for operation in operations:
            if isinstance(operation, RenameColumnOperation):
                title = operation.title.strip()
                result = connection.execute(
                    "UPDATE board_columns SET title = ? "
                    "WHERE board_id = ? AND id = ?",
                    (title, board_id, operation.column_id),
                )
                if not title or result.rowcount == 0:
                    raise ValueError("Invalid column rename")
            elif isinstance(operation, CreateCardOperation):
                title = operation.title.strip()
                column = connection.execute(
                    "SELECT 1 FROM board_columns WHERE board_id = ? AND id = ?",
                    (board_id, operation.column_id),
                ).fetchone()
                if not title or column is None:
                    raise ValueError("Invalid card creation")
                position = connection.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM cards "
                    "WHERE board_id = ? AND column_id = ?",
                    (board_id, operation.column_id),
                ).fetchone()[0]
                connection.execute(
                    "INSERT INTO cards (id, board_id, column_id, title, details, position, priority, due_date) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        f"card-{uuid.uuid4().hex}",
                        board_id,
                        operation.column_id,
                        title,
                        operation.details,
                        position,
                        operation.priority,
                        operation.due_date.isoformat() if operation.due_date else None,
                    ),
                )
            elif isinstance(operation, UpdateCardOperation):
                changes = {}
                if operation.title is not None:
                    title = operation.title.strip()
                    if not title:
                        raise ValueError("Invalid card title")
                    changes["title"] = title
                if operation.details is not None:
                    changes["details"] = operation.details
                if operation.priority is not None:
                    changes["priority"] = operation.priority
                if "due_date" in operation.model_fields_set:
                    changes["due_date"] = operation.due_date.isoformat() if operation.due_date else None
                if not changes:
                    raise ValueError("Empty card update")
                fields = ", ".join(f"{field} = ?" for field in changes)
                result = connection.execute(
                    f"UPDATE cards SET {fields} WHERE board_id = ? AND id = ?",
                    [*changes.values(), board_id, operation.card_id],
                )
                if result.rowcount == 0:
                    raise ValueError("Card not found")
            elif isinstance(operation, MoveCardOperation):
                card = connection.execute(
                    "SELECT column_id FROM cards WHERE board_id = ? AND id = ?",
                    (board_id, operation.card_id),
                ).fetchone()
                destination = connection.execute(
                    "SELECT 1 FROM board_columns WHERE board_id = ? AND id = ?",
                    (board_id, operation.column_id),
                ).fetchone()
                if card is None or destination is None:
                    raise ValueError("Invalid card move")
                source_column_id = card[0]
                source_ids = [
                    row[0]
                    for row in connection.execute(
                        "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                        "ORDER BY position",
                        (board_id, source_column_id),
                    )
                ]
                destination_ids = (
                    source_ids.copy()
                    if source_column_id == operation.column_id
                    else [
                        row[0]
                        for row in connection.execute(
                            "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                            "ORDER BY position",
                            (board_id, operation.column_id),
                        )
                    ]
                )
                source_ids.remove(operation.card_id)
                if source_column_id == operation.column_id:
                    destination_ids = source_ids
                if operation.position > len(destination_ids):
                    raise ValueError("Card position is out of range")
                destination_ids.insert(operation.position, operation.card_id)
                orders = {operation.column_id: destination_ids}
                if source_column_id != operation.column_id:
                    orders[source_column_id] = source_ids
                write_card_order(connection, board_id, orders)
            elif isinstance(operation, DeleteCardOperation):
                card = connection.execute(
                    "SELECT column_id FROM cards WHERE board_id = ? AND id = ?",
                    (board_id, operation.card_id),
                ).fetchone()
                if card is None:
                    raise ValueError("Card not found")
                connection.execute(
                    "DELETE FROM cards WHERE board_id = ? AND id = ?",
                    (board_id, operation.card_id),
                )
                remaining_ids = [
                    row[0]
                    for row in connection.execute(
                        "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                        "ORDER BY position",
                        (board_id, card[0]),
                    )
                ]
                write_card_order(connection, board_id, {card[0]: remaining_ids})

    @app.get("/api/board")
    @app.get("/api/boards/{board_id}")
    def get_board(request: Request, board_id: int | None = None) -> dict[str, object]:
        user = current_user(request)
        return board_data_for_user(int(user["id"]), board_id)

    @app.patch("/api/board/columns/{column_id}")
    @app.patch("/api/boards/{board_id}/columns/{column_id}")
    def rename_column(
        column_id: str, payload: RenameColumn, request: Request, board_id: int | None = None
    ) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]), board_id)
            result = connection.execute(
                "UPDATE board_columns SET title = ? "
                "WHERE board_id = ? AND id = ?",
                (normalized_title(payload.title), board_id, column_id),
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Column not found")
        return board_data_for_user(int(user["id"]), board_id)

    @app.post("/api/board/cards")
    @app.post("/api/boards/{board_id}/cards")
    def create_card(payload: CreateCard, request: Request, board_id: int | None = None) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]), board_id)
            column = connection.execute(
                "SELECT 1 FROM board_columns WHERE board_id = ? AND id = ?",
                (board_id, payload.column_id),
            ).fetchone()
            if column is None:
                raise HTTPException(status_code=404, detail="Column not found")
            position = connection.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM cards "
                "WHERE board_id = ? AND column_id = ?",
                (board_id, payload.column_id),
            ).fetchone()[0]
            connection.execute(
                "INSERT INTO cards (id, board_id, column_id, title, details, position, priority, due_date) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    f"card-{uuid.uuid4().hex}",
                    board_id,
                    payload.column_id,
                    normalized_title(payload.title),
                    payload.details,
                    position,
                    payload.priority,
                    payload.due_date.isoformat() if payload.due_date else None,
                ),
            )
        return board_data_for_user(int(user["id"]), board_id)

    @app.patch("/api/board/cards/{card_id}")
    @app.patch("/api/boards/{board_id}/cards/{card_id}")
    def update_card(
        card_id: str, payload: UpdateCard, request: Request, board_id: int | None = None
    ) -> dict[str, object]:
        user = current_user(request)
        updates = payload.model_dump(exclude_unset=True)
        if not updates or any(value is None for key, value in updates.items() if key != "due_date"):
            raise HTTPException(status_code=422, detail="Provide card fields to update")
        if "title" in updates:
            updates["title"] = normalized_title(updates["title"])
        if updates.get("due_date") is not None:
            updates["due_date"] = updates["due_date"].isoformat()
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]), board_id)
            fields = ", ".join(f"{field} = ?" for field in updates)
            result = connection.execute(
                f"UPDATE cards SET {fields} WHERE board_id = ? AND id = ?",
                [*updates.values(), board_id, card_id],
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Card not found")
        return board_data_for_user(int(user["id"]), board_id)

    @app.post("/api/board/cards/{card_id}/move")
    @app.post("/api/boards/{board_id}/cards/{card_id}/move")
    def move_card(
        card_id: str, payload: MoveCard, request: Request, board_id: int | None = None
    ) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]), board_id)
            card = connection.execute(
                "SELECT column_id FROM cards WHERE board_id = ? AND id = ?",
                (board_id, card_id),
            ).fetchone()
            destination = connection.execute(
                "SELECT 1 FROM board_columns WHERE board_id = ? AND id = ?",
                (board_id, payload.column_id),
            ).fetchone()
            if card is None:
                raise HTTPException(status_code=404, detail="Card not found")
            if destination is None:
                raise HTTPException(status_code=404, detail="Column not found")

            source_column_id = card[0]
            source_card_ids = [
                row[0]
                for row in connection.execute(
                    "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                    "ORDER BY position",
                    (board_id, source_column_id),
                )
            ]
            if source_column_id == payload.column_id:
                destination_card_ids = source_card_ids
            else:
                destination_card_ids = [
                    row[0]
                    for row in connection.execute(
                        "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                        "ORDER BY position",
                        (board_id, payload.column_id),
                    )
                ]
            source_card_ids.remove(card_id)
            if source_column_id == payload.column_id:
                destination_card_ids = source_card_ids
            if payload.position > len(destination_card_ids):
                raise HTTPException(status_code=422, detail="Position is out of range")
            destination_card_ids.insert(payload.position, card_id)

            orders = {payload.column_id: destination_card_ids}
            if source_column_id != payload.column_id:
                orders[source_column_id] = source_card_ids
            write_card_order(connection, board_id, orders)
        return board_data_for_user(int(user["id"]), board_id)

    @app.delete("/api/board/cards/{card_id}")
    @app.delete("/api/boards/{board_id}/cards/{card_id}")
    def delete_card(card_id: str, request: Request, board_id: int | None = None) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]), board_id)
            card = connection.execute(
                "SELECT column_id FROM cards WHERE board_id = ? AND id = ?",
                (board_id, card_id),
            ).fetchone()
            if card is None:
                raise HTTPException(status_code=404, detail="Card not found")
            connection.execute(
                "DELETE FROM cards WHERE board_id = ? AND id = ?",
                (board_id, card_id),
            )
            remaining_ids = [
                row[0]
                for row in connection.execute(
                    "SELECT id FROM cards WHERE board_id = ? AND column_id = ? "
                    "ORDER BY position",
                    (board_id, card[0]),
                )
            ]
            write_card_order(connection, board_id, {card[0]: remaining_ids})
        return board_data_for_user(int(user["id"]), board_id)

    @app.post("/api/ai/chat")
    @app.post("/api/boards/{board_id}/ai/chat")
    def chat(payload: AIChatRequest, request: Request, board_id: int | None = None) -> dict[str, object]:
        user = current_user(request)
        enforce_ai_request_limit()
        user_id = int(user["id"])
        board = board_data_for_user(user_id, board_id)
        messages = build_model_messages(payload.question, payload.history, board)
        try:
            model_content = chat_completion(messages)
        except OpenRouterError as error:
            status_code = 503 if "not configured" in str(error) else 502
            raise HTTPException(status_code=status_code, detail=str(error)) from None
        try:
            assistant_response = AssistantResponse.model_validate_json(model_content)
        except ValidationError:
            raise HTTPException(
                status_code=502, detail="Assistant returned malformed output."
            ) from None

        return {
            "assistant_text": assistant_response.assistant_text,
            "operations": [operation.model_dump(mode="json", exclude_unset=True) for operation in assistant_response.operations],
        }

    @app.post("/api/ai/apply")
    @app.post("/api/boards/{board_id}/ai/apply")
    def apply_ai_changes(payload: AIApplyRequest, request: Request, board_id: int | None = None) -> dict[str, object]:
        user = current_user(request)
        user_id = int(user["id"])
        try:
            with database_connection(resolved_database_path, immediate=True) as connection:
                board_id = board_id_for_user(connection, user_id, board_id)
                apply_assistant_operations(
                    connection, board_id, payload.operations
                )
        except (ValueError, sqlite3.IntegrityError, psycopg.IntegrityError):
            raise HTTPException(
                status_code=502, detail="Assistant proposed invalid board changes."
            ) from None

        return board_data_for_user(user_id, board_id)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/hello")
    def hello() -> dict[str, str]:
        return {"message": "Hello from FastAPI"}

    resolved_static_dir = static_dir or Path(
        os.environ.get(
            "STATIC_DIR",
            Path(__file__).resolve().parents[1] / "frontend" / "out",
        )
    )
    if resolved_static_dir.is_dir():
        app.mount(
            "/", StaticFiles(directory=resolved_static_dir, html=True), name="frontend"
        )

    return app


app = create_app()
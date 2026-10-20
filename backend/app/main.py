from contextlib import contextmanager
from collections import deque
import hashlib
import hmac
import os
import sqlite3
from threading import Lock
import time
import uuid
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

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
SCHEMA_VERSION = 2
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


class RenameColumn(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class CreateCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    column_id: str = Field(alias="columnId", min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    details: str = Field(default="", max_length=5000)


class UpdateCard(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=5000)


class MoveCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    column_id: str = Field(alias="columnId", min_length=1, max_length=100)
    position: int = Field(ge=0)


@contextmanager
def database_connection(
    database_path: Path, immediate: bool = False
) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(database_path, timeout=30)
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


def initialize_database(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with database_connection(database_path) as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema version {version} is newer than supported version {SCHEMA_VERSION}"
            )

        connection.execute("BEGIN IMMEDIATE")
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


def create_app(
    database_path: Path | None = None,
    session_secret: str | None = None,
    static_dir: Path | None = None,
) -> FastAPI:
    resolved_database_path = database_path or Path(
        os.environ.get(
            "DATABASE_PATH",
            Path(__file__).resolve().parents[1] / "data" / "kanban.sqlite3",
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
    resolved_password = configured_password or MVP_PASSWORD

    initialize_database(resolved_database_path)

    app = FastAPI(title="Kanban API")
    app.state.database_path = resolved_database_path
    ai_request_times: deque[float] = deque()
    ai_request_lock = Lock()

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

    def user_for_id(user_id: str) -> dict[str, int | str]:
        with database_connection(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {"id": row[0], "username": row[1]}

    def current_user(request: Request) -> dict[str, int | str]:
        token = request.cookies.get(SESSION_COOKIE, "")
        try:
            user_id, expires_at_text, signature = token.split(".", 2)
            expires_at = int(expires_at_text)
        except ValueError:
            raise HTTPException(status_code=401, detail="Not authenticated") from None
        signed_value = f"{user_id}.{expires_at_text}"
        expected_signature = hmac.new(
            resolved_secret.encode(), signed_value.encode(), hashlib.sha256
        ).hexdigest()
        if (
            not user_id
            or expires_at <= time.time()
            or not hmac.compare_digest(signature, expected_signature)
        ):
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user_for_id(user_id)

    @app.post("/api/auth/login")
    def login(credentials: LoginCredentials, response: Response) -> dict[str, int | str]:
        if (
            credentials.username != MVP_USERNAME
            or credentials.password != resolved_password
        ):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        with database_connection(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username FROM users WHERE username = ?",
                (credentials.username,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        user_id = str(row[0])
        expires_at = str(int(time.time()) + SESSION_TTL_SECONDS)
        signed_value = f"{user_id}.{expires_at}"
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
        return {"id": row[0], "username": row[1]}

    @app.get("/api/auth/me")
    def me(request: Request) -> dict[str, int | str]:
        return current_user(request)

    @app.post("/api/auth/logout")
    def logout(response: Response) -> dict[str, str]:
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=runtime_environment == "production",
            httponly=True,
            samesite="lax",
        )
        return {"status": "ok"}

    def board_id_for_user(connection: sqlite3.Connection, user_id: int) -> int:
        row = connection.execute(
            "SELECT id FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return row[0]

    def board_data_for_user(user_id: int) -> dict[str, object]:
        with database_connection(resolved_database_path) as connection:
            board_id = board_id_for_user(connection, user_id)
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
                "SELECT id, column_id, title, details FROM cards "
                "WHERE board_id = ? "
                "ORDER BY column_id, position",
                (board_id,),
            ).fetchall()
            cards = {}
            for card_id, column_id, title, details in card_rows:
                cards[card_id] = {
                    "id": card_id,
                    "title": title,
                    "details": details,
                }
                columns_by_id[column_id]["cardIds"].append(card_id)
            return {"columns": columns, "cards": cards}

    def normalized_title(title: str) -> str:
        title = title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Title must not be empty")
        return title

    def write_card_order(
        connection: sqlite3.Connection,
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
        connection: sqlite3.Connection,
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
                    "INSERT INTO cards (id, board_id, column_id, title, details, position) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        f"card-{uuid.uuid4().hex}",
                        board_id,
                        operation.column_id,
                        title,
                        operation.details,
                        position,
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
    def get_board(request: Request) -> dict[str, object]:
        user = current_user(request)
        return board_data_for_user(int(user["id"]))

    @app.patch("/api/board/columns/{column_id}")
    def rename_column(
        column_id: str, payload: RenameColumn, request: Request
    ) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]))
            result = connection.execute(
                "UPDATE board_columns SET title = ? "
                "WHERE board_id = ? AND id = ?",
                (normalized_title(payload.title), board_id, column_id),
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Column not found")
        return board_data_for_user(int(user["id"]))

    @app.post("/api/board/cards")
    def create_card(payload: CreateCard, request: Request) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]))
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
                "INSERT INTO cards (id, board_id, column_id, title, details, position) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    f"card-{uuid.uuid4().hex}",
                    board_id,
                    payload.column_id,
                    normalized_title(payload.title),
                    payload.details,
                    position,
                ),
            )
        return board_data_for_user(int(user["id"]))

    @app.patch("/api/board/cards/{card_id}")
    def update_card(
        card_id: str, payload: UpdateCard, request: Request
    ) -> dict[str, object]:
        user = current_user(request)
        updates = payload.model_dump(exclude_unset=True)
        if not updates or any(value is None for value in updates.values()):
            raise HTTPException(status_code=422, detail="Provide card fields to update")
        if "title" in updates:
            updates["title"] = normalized_title(updates["title"])
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]))
            fields = ", ".join(f"{field} = ?" for field in updates)
            result = connection.execute(
                f"UPDATE cards SET {fields} WHERE board_id = ? AND id = ?",
                [*updates.values(), board_id, card_id],
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Card not found")
        return board_data_for_user(int(user["id"]))

    @app.post("/api/board/cards/{card_id}/move")
    def move_card(
        card_id: str, payload: MoveCard, request: Request
    ) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]))
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
        return board_data_for_user(int(user["id"]))

    @app.delete("/api/board/cards/{card_id}")
    def delete_card(card_id: str, request: Request) -> dict[str, object]:
        user = current_user(request)
        with database_connection(resolved_database_path, immediate=True) as connection:
            board_id = board_id_for_user(connection, int(user["id"]))
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
        return board_data_for_user(int(user["id"]))

    @app.post("/api/ai/chat")
    def chat(payload: AIChatRequest, request: Request) -> dict[str, object]:
        user = current_user(request)
        enforce_ai_request_limit()
        user_id = int(user["id"])
        board = board_data_for_user(user_id)
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
            "operations": [operation.model_dump() for operation in assistant_response.operations],
        }

    @app.post("/api/ai/apply")
    def apply_ai_changes(payload: AIApplyRequest, request: Request) -> dict[str, object]:
        user = current_user(request)
        user_id = int(user["id"])
        try:
            with database_connection(resolved_database_path, immediate=True) as connection:
                board_id = board_id_for_user(connection, user_id)
                apply_assistant_operations(
                    connection, board_id, payload.operations
                )
        except (ValueError, sqlite3.IntegrityError):
            raise HTTPException(
                status_code=502, detail="Assistant proposed invalid board changes."
            ) from None

        return board_data_for_user(user_id)

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
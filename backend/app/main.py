import hashlib
import hmac
import os
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

MVP_USERNAME = "user"
MVP_PASSWORD = "password"
SESSION_COOKIE = "kanban_session"


class LoginCredentials(BaseModel):
    username: str
    password: str


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
    resolved_secret = session_secret or os.environ.get(
        "SESSION_SECRET", "local-development-session-secret"
    )

    resolved_database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(resolved_database_path) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE)"
        )
        connection.execute(
            "INSERT OR IGNORE INTO users (username) VALUES (?)",
            (MVP_USERNAME,),
        )

    app = FastAPI(title="Kanban API")
    app.state.database_path = resolved_database_path

    def user_for_id(user_id: str) -> dict[str, int | str]:
        with sqlite3.connect(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {"id": row[0], "username": row[1]}

    def current_user(request: Request) -> dict[str, int | str]:
        token = request.cookies.get(SESSION_COOKIE, "")
        user_id, separator, signature = token.partition(".")
        expected_signature = hmac.new(
            resolved_secret.encode(), user_id.encode(), hashlib.sha256
        ).hexdigest()
        if (
            not separator
            or not user_id
            or not hmac.compare_digest(signature, expected_signature)
        ):
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user_for_id(user_id)

    @app.post("/api/auth/login")
    def login(credentials: LoginCredentials, response: Response) -> dict[str, int | str]:
        if (
            credentials.username != MVP_USERNAME
            or credentials.password != MVP_PASSWORD
        ):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        with sqlite3.connect(resolved_database_path) as connection:
            row = connection.execute(
                "SELECT id, username FROM users WHERE username = ?",
                (credentials.username,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        user_id = str(row[0])
        signature = hmac.new(
            resolved_secret.encode(), user_id.encode(), hashlib.sha256
        ).hexdigest()
        response.set_cookie(
            SESSION_COOKIE,
            f"{user_id}.{signature}",
            httponly=True,
            samesite="lax",
            path="/",
        )
        return {"id": row[0], "username": row[1]}

    @app.get("/api/auth/me")
    def me(request: Request) -> dict[str, int | str]:
        return current_user(request)

    @app.post("/api/auth/logout")
    def logout(response: Response) -> dict[str, str]:
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"status": "ok"}

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
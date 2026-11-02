# Database Design

## Scope

SQLite is the local default. Hosted deployments can use PostgreSQL by setting `DATABASE_URL`; the schema is initialized automatically on startup for either database. Both use the same users, multiple owned boards, fixed columns, and cards model. Passwords are stored only as salted scrypt hashes. The internal persistence representation (not a public account API response) is in [schema-proposal.json](schema-proposal.json).

AI conversation history is not part of the database or schema. It exists only in the active browser session and is discarded on reload or logout.

## Tables (schema version 4)

- `users`: unique username, salted `password_hash`, and `session_version`. Registration accepts 3-64 ASCII letters, numbers, underscores, or hyphens and normalizes usernames to lowercase; passwords require 12-256 characters. Legacy uncredentialed users remain intact but cannot sign in.
- `boards`: owner `user_id REFERENCES users(id) ON DELETE CASCADE`, `name`, and `description`; an owner can have any number of boards, including zero. SQLite user and board IDs use `INTEGER PRIMARY KEY AUTOINCREMENT` to prevent deleted IDs from being reused; PostgreSQL uses identity sequences.
- `board_columns`: `board_id INTEGER NOT NULL`; stable column `id` and `key`; editable `title`; fixed `position`. Use a composite primary key `(board_id, id)`, unique `(board_id, key)` and `(board_id, position)`, and a foreign key to `boards(id) ON DELETE CASCADE`. Check the exact pairs `col-backlog/backlog/0`, `col-discovery/discovery/1`, `col-progress/progress/2`, `col-review/review/3`, and `col-done/done/4`. Seed exactly one of each; the API only renames titles and never creates, deletes, or reorders columns.
- `cards`: string ID, board/column ownership, non-empty title, details, position, priority (`low`, `medium`, `high`, `urgent`), and optional ISO `due_date`. A composite foreign key `(board_id, column_id)` references `board_columns(board_id, id)` with `ON DELETE CASCADE`. A unique constraint on `(board_id, column_id, position)` keeps order unambiguous.

The `board_columns` composite primary key is also the unique target for the card foreign key. Card moves and reorders run in a transaction; update positions through temporary values before assigning the final contiguous order.

## Ownership and Isolation

The authenticated user ID comes only from the validated session, never from a request body. Resolve the board using both its ID and `user_id`; read, update, delete, and move cards only through that owned board. Resolve destination columns through the same board. Do not treat possession of a board, column, or card ID as authorization. The composite card-to-column foreign key prevents assigning a card to a column on a different board; application queries still enforce user ownership.

Enable `PRAGMA foreign_keys = ON` on every SQLite connection. The JSON Schema describes each row and fixed column mapping; cross-row uniqueness and references are database constraints, not guarantees of JSON Schema validation. The unique card-position constraint also supports listing cards in order by `(board_id, column_id, position)`.

## Creation and Migrations

SQLite uses `DATABASE_PATH` and `PRAGMA user_version`; PostgreSQL uses `DATABASE_URL` and an `app_schema_version` table. PostgreSQL URLs beginning with `postgres://` are accepted. Startup creates missing tables and seeds the MVP user, board, and fixed columns without replacing existing card data. Writes use transactions, and PostgreSQL writes are serialized with a transaction-scoped advisory lock. An unknown newer schema version fails startup rather than being silently altered. Future schema changes must add matching migrations for both database backends.

Version 3 removes the one-board-per-user constraint, adds credential/session fields and board/task metadata, and hashes the initial account's configured password. Version 4 prevents SQLite ID reuse; PostgreSQL already uses non-recycling sequences. SQLite migrations run under an immediate transaction with foreign keys disabled only on the migration connection and checked before commit. Back up the database before upgrading.

`MVP_PASSWORD` applies only when migrating/seeding the original account, not on every restart. Change existing credentials in account settings. Production refuses a database whose original account still has the development password. Deleting an account cascades through its boards, columns, and cards; normal restarts do not recreate deleted accounts or boards.

Sessions contain a signed user ID, session version, and expiry. Password changes and logout increment the version, revoking all previously issued sessions for that account. Password changes issue a replacement cookie for the current browser. Account deletion invalidates every session. Cookies remain HttpOnly, SameSite=Lax, and Secure in production. Account attempts are limited to 60/minute per application process; the assistant retains its separate request limit.

## API compatibility

The workspace UI uses `/api/boards` and `/api/boards/{board_id}`, with nested `/columns/{id}`, `/cards`, `/cards/{id}`, `/cards/{id}/move`, `/ai/chat`, and `/ai/apply`. Every nested route verifies board ownership before reading or writing data. Unknown and foreign boards return 404. The legacy `/api/board` and `/api/ai/*` routes target the user's oldest remaining board and return 404 for an empty workspace.

Account APIs include `/api/auth/register`, `/login`, `/me`, `/logout`, `/password`, and `DELETE /api/auth/account`. Destructive account deletion requires the current username and password. Board deletion requires explicit confirmation in the UI. Team collaboration, administrative user management, email recovery, and password reset delivery are not implemented.

The hosted PostgreSQL database is initialized as a new empty board; local SQLite data is not automatically copied or migrated. No export/import tool is currently provided. The eight frontend example cards remain demo data and are not copied into either database. This empty-board seed behavior was approved with the schema proposal.

## Review Gate

The schema and database approach, including an initially empty board, were approved before Part 6 implementation.
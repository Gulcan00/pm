# Database Design

## Scope

SQLite is the local default. Hosted deployments can use PostgreSQL by setting `DATABASE_URL`; the schema is initialized automatically on startup for either database. Both use the same users, boards, fixed columns, and cards model. The plaintext MVP password is not stored. The JSON representation is in [schema-proposal.json](schema-proposal.json).

AI conversation history is not part of the database or schema. It exists only in the active browser session and is discarded on reload or logout.

## Proposed Tables

- `users`: retain `id INTEGER PRIMARY KEY` and `username TEXT NOT NULL UNIQUE` from the current implementation.
- `boards`: `id INTEGER PRIMARY KEY`; `user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`. The unique owner constraint enforces at most one board per user.
- `board_columns`: `board_id INTEGER NOT NULL`; stable column `id` and `key`; editable `title`; fixed `position`. Use a composite primary key `(board_id, id)`, unique `(board_id, key)` and `(board_id, position)`, and a foreign key to `boards(id) ON DELETE CASCADE`. Check the exact pairs `col-backlog/backlog/0`, `col-discovery/discovery/1`, `col-progress/progress/2`, `col-review/review/3`, and `col-done/done/4`. Seed exactly one of each; the API only renames titles and never creates, deletes, or reorders columns.
- `cards`: `id TEXT PRIMARY KEY` to preserve the frontend's string IDs; `board_id INTEGER NOT NULL`; `column_id TEXT NOT NULL`; non-empty `title`; `details TEXT NOT NULL`; non-negative `position`. A composite foreign key `(board_id, column_id)` references `board_columns(board_id, id)` with `ON DELETE CASCADE`. A unique constraint on `(board_id, column_id, position)` keeps order unambiguous.

The `board_columns` composite primary key is also the unique target for the card foreign key. Card moves and reorders run in a transaction; update positions through temporary values before assigning the final contiguous order.

## Ownership and Isolation

The authenticated user ID comes only from the validated session, never from a request body. Resolve the board using both its ID and `user_id`; read, update, delete, and move cards only through that owned board. Resolve destination columns through the same board. Do not treat possession of a board, column, or card ID as authorization. The composite card-to-column foreign key prevents assigning a card to a column on a different board; application queries still enforce user ownership.

Enable `PRAGMA foreign_keys = ON` on every SQLite connection. The JSON Schema describes each row and fixed column mapping; cross-row uniqueness and references are database constraints, not guarantees of JSON Schema validation. The unique card-position constraint also supports listing cards in order by `(board_id, column_id, position)`.

## Creation and Migrations

SQLite uses `DATABASE_PATH` and `PRAGMA user_version`; PostgreSQL uses `DATABASE_URL` and an `app_schema_version` table. PostgreSQL URLs beginning with `postgres://` are accepted. Startup creates missing tables and seeds the MVP user, board, and fixed columns without replacing existing card data. Writes use transactions, and PostgreSQL writes are serialized with a transaction-scoped advisory lock. An unknown newer schema version fails startup rather than being silently altered. Future schema changes must add matching migrations for both database backends.

The hosted PostgreSQL database is initialized as a new empty board; local SQLite data is not automatically copied or migrated. No export/import tool is currently provided. The eight frontend example cards remain demo data and are not copied into either database. This empty-board seed behavior was approved with the schema proposal.

## Review Gate

The schema and database approach, including an initially empty board, were approved before Part 6 implementation.
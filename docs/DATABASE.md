# SQLite Database Proposal

## Scope

SQLite remains the local persistent store. The existing `users` table and seeded `user` identity remain; the plaintext MVP password is not stored. The proposed schema adds one board per user, five fixed columns per board, and cards ordered within columns. The JSON representation is in [schema-proposal.json](schema-proposal.json).

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

Keep the database path configurable through `DATABASE_PATH`; Docker's existing named volume preserves the file across container restarts. On startup, create the parent directory if needed, open the database, enable foreign keys, and apply pending migrations in a transaction. Use SQLite `PRAGMA user_version` as the migration version. The initial migration preserves or creates the existing users table and idempotently seeds `user`; the next migration creates board tables, then creates one board and the five fixed columns for each existing user. Normal restarts must not replace existing rows or reset card data. Future schema changes add numbered migrations; an unknown newer schema version should fail startup rather than be silently altered.

Create each board with the five fixed columns and no cards. The eight frontend example cards remain demo data and are not copied into SQLite. This empty-board seed behavior was approved with the schema proposal.

## Review Gate

The schema and database approach, including an initially empty board, were approved before Part 6 implementation.
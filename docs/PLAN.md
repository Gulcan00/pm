# Project Plan

## Decisions and Constraints

- The app is a local Dockerized MVP: Next.js frontend, Python FastAPI backend, SQLite database, and OpenRouter for AI requests.
- FastAPI serves the statically built Next.js app at `/` and provides the API.
- The MVP login credentials are `user` and `password`. SQLite has a seeded user record so board ownership is represented in the data model; do not store the plaintext password in SQLite.
- AI conversation history is transient for the active chat session. Keep it out of SQLite and discard it when the chat session ends, the user logs out, or the page is reloaded.
- The MVP has one board per user and fixed columns whose titles can be renamed. Cards can be created, edited, deleted, and moved between columns.
- Keep changes and dependencies minimal. Do not add features outside this plan without approval.
- Keep `OPENROUTER_API_KEY` in the project-root `.env`; do not expose it to the browser, commit it, or print it in logs.
- Use `openai/gpt-oss-120b` through OpenRouter. Automated tests must not require live credentials or incur API costs; live connectivity checks are explicit and opt-in.
- Preserve the existing frontend visual language and the palette in the root `AGENTS.md`.

## Part 1: Detailed Plan and Frontend Guidance

- [x] Expand every project stage into implementation tasks, tests, and measurable completion gates.
- [x] Add `frontend/AGENTS.md` describing the existing app structure, data flow, dependencies, and test commands.
- [x] Record the agreed session-only AI history and seeded-user decisions above.
- [x] Have the user review and approve this plan before beginning Part 2.

**Tests:** Review the plan against the business requirements and root `AGENTS.md`; verify frontend guidance against the current source and package scripts.

**Success criteria:** Every stage has a checklist, tests, and an observable completion gate. The user has approved the plan. No implementation beyond planning documentation begins before approval.

## Part 2: Docker and Backend Scaffolding

- [x] Inspect existing backend and scripts instructions; select the minimal FastAPI, `uv`, and Docker layout consistent with them.
- [x] Add the backend application entry point and a health/example API route.
- [x] Add a minimal static HTML response for the initial container smoke test.
- [x] Add a Docker build that runs the FastAPI app and make the container configuration suitable for later serving the exported frontend at `/`.
- [x] Add start and stop scripts for macOS, Windows, and Linux. Scripts must be safe to run repeatedly and report whether the app started or stopped successfully.
- [x] Document only the prerequisites and commands needed to build, start, inspect, and stop the local app.

**Tests:**

- [x] Backend unit tests for the HTML page, health route, and example API route.
- [x] Verify the locked production dependency sync used by the Dockerfile.
- [x] Build the Docker image; start the container, request the HTML page and API route, then stop it.
- [x] Exercise the platform script corresponding to the current OS and review the other scripts for matching behavior.

**Success criteria:** Verified on Windows: a clean local Docker build starts through the documented script, serves the example HTML and API response, and stops through its matching stop script without relying on a globally installed Python runtime. The macOS/Linux shell scripts were reviewed but not executed here.

## Part 3: Serve the Existing Frontend

- [x] Configure Next.js for a static production export compatible with the existing client-side Kanban app.
- [x] Build the frontend during the Docker image build and have FastAPI serve the exported files at `/`.
- [x] Confirm static assets and browser-side navigation resolve correctly through the packaged app.
- [x] Retain the frontend's existing component and utility tests; verify the packaged frontend/API origin.

**Tests:**

- [x] `npm run lint`.
- [x] `npm run test:unit` (6 tests).
- [x] `npm run test:e2e` (3 tests).
- [x] `npm run build` produces a static export.
- [x] Docker image build and production smoke test: `/` returned the Kanban page; a referenced JavaScript chunk and stylesheet returned HTTP 200; `/api/health` and `/api/hello` returned the expected responses.
- [x] Backend route tests (2 tests).

**Success criteria:** Verified locally: the Dockerized production app shows the existing demo Kanban at `/`; its static assets load; API routes remain available; and the existing board interactions pass browser tests.

## Part 4: MVP Sign-In and Sign-Out

- [x] Add a sign-in screen shown before the board and validate the MVP credentials `user` / `password`.
- [x] Add a seeded SQLite user record for the MVP identity; do not save the plaintext password.
- [x] Add a signed, HttpOnly authenticated session cookie tied to the seeded user.
- [x] Add sign-out and require a valid session for the identity endpoint. Require authentication on board routes when they are added in Part 6.
- [x] Keep the frontend static; all credential checking and session handling remains in FastAPI.

**Tests:**

- [x] Backend tests for seeded user, valid/invalid credentials, HttpOnly session creation, authenticated identity, logout, health, and example routes (6 tests).
- [x] Frontend unit tests for unauthenticated state, successful login, and logout (3 tests).
- [x] Playwright tests for rejected credentials, sign-in, board visibility, session continuity after reload, sign-out, and existing board interactions (4 tests).
- [x] Frontend lint and static export build.

**Success criteria:** Verified locally: a visitor sees the login screen before the board; only `user` / `password` succeeds; the signed cookie restores the session on reload; logout clears it; the seeded SQLite record contains no password; and the frontend remains a static export.

## Part 5: Database Schema Proposal and Approval

- [ ] Define a JSON schema proposal covering users, one board per user, fixed board columns, cards, and ordering/ownership relationships.
- [ ] Document SQLite creation, initialization, ownership, and migration approach in `docs/`.
- [ ] Specify constraints that prevent cards or boards from being read or changed across users.
- [ ] Explicitly keep AI conversation history out of the persisted schema.
- [ ] Present the JSON schema and database approach for user sign-off before implementing persistence or board API routes.

**Tests:** Validate the proposal as JSON and review it against the one-board-per-user, seeded-user, fixed-column, and card requirements.

**Success criteria:** A valid, reviewed schema proposal and concise database design document are approved by the user. No database implementation proceeds before sign-off.

## Part 6: Persistent Backend Board API

- [ ] Initialize SQLite and create/seed required tables and the MVP user when the database is absent; preserve existing data on normal restarts.
- [ ] Implement authenticated routes to read the current user's board and update board columns and cards.
- [ ] Enforce the approved schema constraints and user ownership in every query or mutation.
- [ ] Validate request data and return consistent errors for invalid or missing resources.
- [ ] Keep the API limited to board operations needed by the UI and AI workflow.

**Tests:** Backend unit/integration tests for first-run database creation, seeding, restart persistence, board reads and mutations, invalid input, missing records, and user isolation. Use a temporary test database.

**Success criteria:** A missing database is initialized automatically; authenticated board changes persist across app restarts; tests prove one user's operations cannot access another user's board.

## Part 7: Connect the Frontend to the Backend

- [ ] Replace in-memory initial board ownership with API-loaded board data.
- [ ] Connect card create, edit, delete, move, and column rename actions to the API.
- [ ] Add clear loading and recoverable error states without losing unsaved user input unnecessarily.
- [ ] Keep the current interaction model and styling while ensuring API requests use the authenticated same-origin session.
- [ ] Cover the integrated user workflow from sign-in through persisted board changes.

**Tests:** Frontend unit tests for API states and interactions; backend tests remain green; Playwright tests against the Dockerized app for CRUD, drag-and-drop, rename, reload persistence, and logout protection.

**Success criteria:** The board shown in the browser is the authenticated user's SQLite-backed board, and supported edits remain after reload and container restart.

## Part 8: OpenRouter Connectivity

- [ ] Add a backend-only OpenRouter client configured from `OPENROUTER_API_KEY` and model `openai/gpt-oss-120b`.
- [ ] Keep credentials server-side and provide actionable errors without logging secrets.
- [ ] Add an opt-in connectivity check that asks `2+2` and verifies a usable response.
- [ ] Mock the OpenRouter boundary in default automated tests.

**Tests:** Unit tests for request construction, successful response parsing, missing credentials, and provider errors using mocks; explicit live `2+2` smoke check only when the user has configured a key and requested the check.

**Success criteria:** Automated tests pass without network access or secrets; the opt-in check returns the model's answer through the backend without exposing the API key.

## Part 9: Structured AI Board Assistant API

- [ ] Define and validate a structured response containing assistant text and an optional set of board operations.
- [ ] Send the current user's board JSON, current question, and transient conversation history to the model on every assistant request.
- [ ] Instruct the model to propose only supported board operations; validate all proposed operations server-side against the authenticated user's board.
- [ ] Apply valid operations through the same persistence rules as normal board mutations and return the assistant text plus the resulting board or board changes.
- [ ] Keep conversation history in the active client session only; do not persist it in SQLite or server logs.
- [ ] Handle malformed model output, rejected operations, and provider errors without applying partial or invalid board changes.

**Tests:** Mocked backend tests for request context, structured response parsing, text-only answers, valid and invalid operations, ownership, atomic updates, malformed output, and provider errors. No default test calls OpenRouter live.

**Success criteria:** Each AI request receives the current board and session context; valid optional operations persist only for the authenticated user; invalid output cannot corrupt the board; chat history is not persisted.

## Part 10: AI Chat Sidebar and End-to-End Workflow

- [ ] Add a responsive AI chat sidebar to the existing board interface, with message history for the active page session and pending/error states.
- [ ] Submit user questions and transient history to the backend AI route.
- [ ] Render assistant text and apply any returned board update to the visible board automatically.
- [ ] Clear chat history on logout and page reload; keep the board and chat usable when the provider is unavailable.
- [ ] Complete accessibility and responsive checks for the board and sidebar.

**Tests:** Frontend unit tests for chat rendering, submission, errors, history clearing, and applying returned board data; Playwright tests for a mocked assistant response with and without a board update, reload/logout history clearing, and provider failure. Run the full frontend suite and backend suite.

**Success criteria:** A signed-in user can chat with the assistant; responses appear in the sidebar; valid board updates become visible and persist without a manual refresh; transient history is discarded at the defined session boundaries.

## Approval Gates

- Part 1 must be approved before Part 2 starts.
- Part 5 schema and database approach must be approved before Part 6 starts.
- Do not begin a later part until the current part's success criteria and tests pass, unless the user approves a change in scope or sequence.
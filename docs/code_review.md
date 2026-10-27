# Code Review

**Review date:** 2026-10-27  
**Scope:** Tracked application source, tests, Docker/Compose and deployment configuration, scripts, and project documentation. Generated build output and dependency contents were excluded from the source review.

## Findings

### 1. OpenRouter requests do not send the configured API key

**Severity:** High  
**Location:** `backend/app/openrouter.py:21-30`; `backend/tests/test_openrouter.py:41`

The client checks that `OPENROUTER_API_KEY` is configured but sends a literal placeholder in the `Authorization` header. Assistant requests and the connectivity check will fail authentication even with a valid key. The unit test asserts the placeholder, preserving the defect.

**Recommended action:** Send the resolved key as a bearer token and update the test to assert the injected test key without logging credentials.

### 2. Public sign-in allows unlimited password guesses

**Severity:** Medium  
**Location:** `backend/app/main.py:378-405`; public exposure in `render.yaml` and `compose.oci.yaml`

Failed login attempts are not limited. The service can be exposed publicly, leaving the single MVP account open to unlimited online password guesses.

**Recommended action:** Add a modest failed-login throttle and return a retry interval when the limit is reached.

### 3. Expired sessions leave the open board in a retry-only error state

**Severity:** Medium  
**Location:** `frontend/src/components/KanbanBoard.tsx:39-55, 71-99`

When a board request receives 401, the UI treats it as a generic error and offers retry. Retrying cannot succeed with the expired cookie. Save failures likewise do not distinguish an expired session from transient errors. Reloading returns the user to sign-in, but the current board view does not.

**Recommended action:** Handle authenticated API 401 responses as an expired session and return the user to sign-in, while preserving retry behavior for transient errors.

### 4. Start scripts report success before the app is ready

**Severity:** Low  
**Location:** `scripts/start.ps1:5-10`; `scripts/start.sh:7-8`

Detached Compose startup may return before the app passes its health check, but both scripts immediately report that it is running.

**Recommended action:** Wait for `/api/health` with a bounded timeout and provide useful status/log guidance if the app does not become ready.

### 5. Generated test artifacts are tracked

**Severity:** Low  
**Location:** `frontend/test-results/.last-run.json`; `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`

These are generated test outputs tracked in version control, so local test runs can create noisy or machine-specific changes.

**Recommended action:** Remove the generated files from version control and ignore the repository-root `node_modules` directory.

## Verification

- Backend: `backend\.venv\Scripts\python.exe -m pytest -q` from `backend` — **32 passed** (one Starlette deprecation warning).
- Frontend lint and unit tests passed (16 tests).
- Docker and Playwright checks were not run because the Docker daemon was unavailable.
- The four previously documented application findings remain unresolved. The expired-session finding is specifically that retrying in the open board cannot recover; reloading returns the user to sign-in.

# Code Review

**Review date:** 2026-10-22  
**Scope:** Tracked application source, tests, Docker/Compose configuration, scripts, and project documentation. Generated dependencies and build output were excluded except for tracked test artifacts noted below.

## Findings

### 1. OpenRouter requests never use the configured API key

**Severity:** High  
**Location:** `backend/app/openrouter.py:29`; `backend/tests/test_openrouter.py:41`

`chat_completion` resolves `OPENROUTER_API_KEY`, but sends a fixed placeholder as the `Authorization` header instead of constructing bearer authentication from the resolved key. Consequently, real assistant requests and the opt-in connectivity check are rejected by OpenRouter even when the key is configured. The request test currently asserts the placeholder, so it locks in the defect rather than detecting it.

**Action:** Send the resolved key using OpenRouter's bearer-authentication header. Change the unit test to assert the correct header for its injected test key, without printing or logging real credentials, and verify the connectivity check with a mocked provider response.

### 2. The public sign-in endpoint has no attempt throttling

**Severity:** Medium  
**Location:** `backend/app/main.py:236-241`; production exposure in `compose.oci.yaml:1-24`

The login route checks credentials but imposes no limit on failed attempts. The OCI Compose stack publishes the app through public HTTPS, leaving the single `user` account exposed to unlimited online password guesses. Production's 12-character minimum does not itself limit attempts or enforce password strength.

**Action:** Add a modest per-source or per-account failed-login throttle and return a retry interval when the limit is reached. Keep the local MVP login workflow and automated tests independent of external services.

### 3. An expired session leaves the open board in a retry-only state

**Severity:** Medium  
**Location:** `backend/app/main.py:33, 217-235`; `frontend/src/components/AuthGate.tsx:15-30`; `frontend/src/components/KanbanBoard.tsx:39-47`

Sessions expire after 24 hours. `AuthGate` checks the session only when it mounts; if the board request later receives a 401, `KanbanBoard` turns it into a generic load error and offers retry without returning the user to sign-in. Retrying cannot recover because the cookie remains expired. Board mutations similarly show generic save failures.

**Action:** Handle authenticated API 401 responses as an expired session and transition the UI back to sign-in, while keeping transient network/server errors on the existing retry path.

### 4. Start scripts can report success before the app is ready

**Severity:** Low  
**Location:** `scripts/start.ps1:5-10`; `scripts/start.sh:7-8`

Both scripts print “running” immediately after `docker compose up -d --build` succeeds. Detached Compose startup does not establish that the app has passed its health check, so users can receive a success message while the container is still starting or has become unhealthy.

**Action:** Wait for `/api/health` (with a bounded timeout), and report failure with useful Compose status/log guidance if the endpoint never becomes ready.

## Repository hygiene

`frontend/test-results/.last-run.json` and `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` are tracked generated test artifacts. Remove these from version control and ignore the repository-root `node_modules` directory so local tool output does not enter future changes.

## Verification

- Backend: `backend\\.venv\\Scripts\\python.exe -m pytest -q` from `backend` — **30 passed**.
- Frontend lint: `npm run lint` from `frontend` — completed without diagnostics.
- Frontend unit tests: `npm run test:unit` from `frontend` — **16 passed**.
- Docker/Playwright checks were not run as part of this review.

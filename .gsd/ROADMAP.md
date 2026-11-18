# Roadmap: Bugify Website Backend

**Scope:** Website Backend Only (`backend/`)  
**Target Completion:** 21 November 2026  
**Rules Reference:** `PROJECT_RULES.md` (SPEC → PLAN → EXECUTE → VERIFY → COMMIT)  

---

## Progress Overview

| Phase | Description | Status |
| :--- | :--- | :--- |
| **Phase 1** | Environment, Dependencies & Database Setup | Ready to execute |
| **Phase 2** | Server Health & Port Alignment | Pending Phase 1 |
| **Phase 3** | Resilient Code Execution & Redaction Pipeline | Pending Phase 2 |
| **Phase 4** | Submission History & Detail Retrieval Hardening | Pending Phase 3 |
| **Phase 5** | Automated Website Backend Integration Tests | Pending Phase 4 |
| **Phase 6** | End-to-End Frontend Verification & Handover | Pending Phase 5 |

---

## Detailed Task Breakdown

### Phase 1: Environment, Dependencies & Database Setup

#### Task 1.1: Install Backend Dependencies & Generate Prisma Client
* **Objective:** Install npm packages in `backend/` and generate the Prisma Client on disk so backend scripts and servers can run.
* **Files Touched:** `backend/package-lock.json`, `backend/node_modules/`
* **Actions:**
  1. Run `npm install` inside `backend/`.
  2. Run `npx prisma generate` inside `backend/`.
* **Verification Command:** `node -e "console.log(require('@prisma/client') ? 'Prisma Client OK' : 'Failed')"`
* **Required Proof:** Console output printing `Prisma Client OK`.
* **Commit Message:** `chore(setup): install backend dependencies and generate prisma client`

#### Task 1.2: Environment Configuration & Database Initialization
* **Objective:** Create active `backend/.env` configuration and ensure the PostgreSQL container is accepting connections on port 5432.
* **Files Touched:** `backend/.env`
* **Actions:**
  1. Create `backend/.env` from `backend/.env.example` with `PORT=5000` and `DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/bugify?schema=public`.
  2. Launch PostgreSQL container via `docker compose up -d postgres`.
* **Verification Command:** `docker compose ps` / `pg_isready -h localhost -p 5432 -U postgres`
* **Required Proof:** Command output showing `postgres` container status `healthy` or `accepting connections`.
* **Commit Message:** `chore(db): configure backend environment and start postgres database`

#### Task 1.3: Database Migration Deployment & Seed Verification
* **Objective:** Deploy existing Prisma migrations to PostgreSQL and seed initial demo data (`demo@bugify.dev`, languages `python` and `javascript`, and `UserProgress`).
* **Files Touched:** Database schema state.
* **Actions:**
  1. Run `npx prisma migrate deploy` in `backend/`.
  2. Run `npm run seed` in `backend/`.
* **Verification Command:** `node -e "const p = require('./backend/src/prisma'); Promise.all([p.user.count(), p.language.count()]).then(([u, l]) => { console.log('Users:', u, 'Languages:', l); process.exit(0); });"`
* **Required Proof:** Console output showing `Users: 1 Languages: 2`.
* **Commit Message:** `chore(db): apply migrations and seed demo user and languages`

---

### Phase 2: Server Health & Port Alignment

#### Task 2.1: Server Port & Proxy Compatibility Verification
* **Objective:** Ensure the backend runs on port 5000 (matching `frontend/vite.config.js` proxy target `http://127.0.0.1:5000`) and serves `/api/health`.
* **Files Touched:** `backend/src/server.js`, `backend/.env`
* **Actions:**
  1. Validate that `backend/src/server.js` listens on `process.env.PORT || 5000`.
  2. Verify that CORS is enabled and requests from the frontend origin are allowed.
* **Verification Command:** Run server in background and run `curl -s http://127.0.0.1:5000/api/health`
* **Required Proof:** Captured HTTP response `{"status":"ok","message":"Bugify backend is running"}`.
* **Commit Message:** `fix(server): align backend listening port with frontend proxy configuration`

---

### Phase 3: Resilient Code Execution & Redaction Pipeline

#### Task 3.1: Resilient Execution Fallback for Offline / Unreachable Judge0
* **Objective:** Enhance `codeExecutionService.js` so that if the external Judge0 API is unreachable, rate-limited, or disabled, it automatically falls back to `executionService.js` (heuristic/local execution) instead of returning an unhandled 503 error.
* **Files Touched:** `backend/src/services/codeExecutionService.js`
* **Actions:**
  1. Implement a try/catch fallback in `executeCode()`: on network failure, invoke `executionService.executeCode()`.
  2. Tag the telemetry to record whether execution used `"judge0"` or `"local_fallback"`.
* **Verification Command:** Run an offline mock test calling `executeCode({ code: 'print(10/0)', language: 'python' })` with `JUDGE0_API_URL=http://invalid.local`.
* **Required Proof:** Successful execution object returned containing `status: "error"`, `errorType: "ZERO_DIVISION_ERROR"`.
* **Commit Message:** `feat(execution): add resilient fallback for offline or unreachable judge0 service`

#### Task 3.2: Secret Token Redaction on Code Intake
* **Objective:** Redact sensitive credentials (API keys, passwords, bearer tokens) from user code before persisting in `Submission.code` or forwarding to AI prompt APIs.
* **Files Touched:** `backend/src/controllers/submissionController.js`
* **Actions:**
  1. Import `redactSecrets` from `../services/redactService`.
  2. Redact sensitive patterns in `code` before transaction persistence and AI explanation requests.
* **Verification Command:** Test script submitting code containing a dummy OpenAI key (`sk-1234567890abcdef1234567890abcdef`) and querying the database to ensure the key is saved as `[REDACTED API KEY]`.
* **Required Proof:** Database query output showing the redacted token.
* **Commit Message:** `feat(submissions): apply secret token redaction to submitted code`

---

### Phase 4: Submission History & Detail Retrieval Hardening

#### Task 4.1: Harden Submission History & Retrieval Error Handling
* **Objective:** Ensure `GET /api/submissions` and `GET /api/submissions/:id` strictly conform to the frontend contract and defensively handle invalid IDs and missing records.
* **Files Touched:** `backend/src/controllers/submissionController.js`
* **Actions:**
  1. Verify `GET /api/submissions` returns an array sorted descending by `createdAt`, selecting `id`, `language`, `errorType`, `status`, and `createdAt`.
  2. Verify `GET /api/submissions/:id` returns `400` for non-integer IDs and `404` with `{ success: false, message: "..." }` for missing submissions.
* **Verification Command:** `curl -s http://127.0.0.1:5000/api/submissions/abc` (checks 400) and `curl -s http://127.0.0.1:5000/api/submissions/99999` (checks 404).
* **Required Proof:** Captured HTTP status codes and JSON error messages.
* **Commit Message:** `fix(submissions): harden submission history retrieval and error handling`

---

### Phase 5: Automated Website Backend Integration Tests

#### Task 5.1: Implement Integration Test Suite for Submissions API
* **Objective:** Provide automated regression testing for all website backend routes using the native Node.js test runner (`node:test`).
* **Files Touched:** `backend/test/submissions.test.js`
* **Actions:**
  1. Write tests covering:
     * `POST /api/submissions`: valid clean execution (returns success).
     * `POST /api/submissions`: runtime error / divide by zero (returns error + AI explanation).
     * `POST /api/submissions`: missing code or language (returns 400).
     * `POST /api/submissions`: unsupported language (returns 400).
     * `GET /api/submissions`: returns formatted history list.
     * `GET /api/submissions/:id`: returns complete submission detail.
     * `GET /api/submissions/:id`: returns 404 for nonexistent ID.
* **Verification Command:** `node --test backend/test/submissions.test.js`
* **Required Proof:** Test output showing all tests passing (0 failures).
* **Commit Message:** `test(submissions): add integration test suite for website submission endpoints`

---

### Phase 6: End-to-End Frontend Verification & Handover

#### Task 6.1: End-to-End Integration Verification with Existing Frontend
* **Objective:** Verify live communication between the React frontend (`frontend/src/App.jsx`) and the Express backend through the Vite dev proxy.
* **Actions:**
  1. Start backend on port 5000 and frontend on port 5173.
  2. Verify that running code updates the UI with error analysis and suggested fix.
  3. Verify that the "Apply to Editor" button inserts the fix into the code editor.
  4. Verify that the Debugging History sidebar displays the newly created record.
* **Verification Command:** Capture API roundtrip verification and frontend state confirmation.
* **Required Proof:** Successful verification logs and HTTP responses confirming end-to-end integration.
* **Commit Message:** `docs(backend): record end-to-end verification and integration notes`

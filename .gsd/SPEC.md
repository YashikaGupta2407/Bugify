# Specification: Bugify Website Backend

**Status: FINALIZED**  
**Component:** Website Backend (`backend/`)  
**Target Completion:** 21 November 2026  
**Author:** Backend Engineering  

---

## 1. Overview & Objectives

The goal is to deliver a fully functional, resilient, and verifiable backend for the **Bugify Website**. The website frontend is already constructed in React (`frontend/src/App.jsx`). The backend must support the complete code execution, error classification, AI bug explanation, and debugging history retrieval pipeline without modifying the existing frontend or the browser/VS Code extension.

### 1.1 In-Scope
* Express application configuration and port alignment for website frontend proxy.
* PostgreSQL database connection and Prisma schema migrations and seeding.
* `POST /api/submissions`: Code execution via Judge0 with resilient offline/heuristic fallback.
* Error classification into standardized Bugify categories via `errorClassifier.js`.
* AI-driven (Gemini/OpenAI) and heuristic mentor explanation generation via `aiExplanationService.js`.
* Atomic persistence of submissions, results, explanations, and user progress metrics in PostgreSQL.
* `GET /api/submissions`: Retrieve recent debugging history list for the active user.
* `GET /api/submissions/:id`: Retrieve detailed submission record with execution results and explanation.
* Secret redaction on submitted code before external transmission and database persistence.
* Automated integration test suite (`backend/test/submissions.test.js`) verifying all website endpoints.

### 1.2 Out-of-Scope (Non-Goals)
* Browser / VS Code extension development, extension routes (`/api/extension/*`), or extension analyzers.
* Modification of the existing frontend codebase (`frontend/src/App.jsx`, `frontend/src/App.css`, etc.).
* Standalone user authentication pages (login/signup UI does not exist in the current frontend).
* Problem catalog management (`Problem` and `TestCase` endpoints are deferred post-MVP).

---

## 2. API Contracts & Specifications

The backend must strictly satisfy the contracts expected by `frontend/src/App.jsx`:

### 2.1 `POST /api/submissions`
* **Purpose:** Execute submitted code, detect errors, generate AI explanation, and persist attempt.
* **Headers:** `Content-Type: application/json`
* **Request Body:**
  ```json
  {
    "language": "python",
    "code": "def divide(a, b):\n    return a / b\n\nprint(divide(10, 0))",
    "stdin": ""
  }
  ```
* **Validation Rules:**
  * `code`: Required, non-empty string. Return `400 Bad Request` if empty.
  * `language`: Required string. Currently supported: `"python"`. Return `400 Bad Request` if unsupported.
  * `stdin`: Optional string (defaults to `""`).
* **Success Response (Error in Code Execution):** `200 OK`
  ```json
  {
    "success": true,
    "result": {
      "status": "error",
      "errorType": "ZERO_DIVISION_ERROR",
      "errorMessage": "division by zero",
      "output": "",
      "executionTime": 0.04,
      "submissionId": 1
    },
    "explanation": {
      "summary": "The program attempted to divide a number by zero.",
      "cause": "A division operation was executed where the denominator evaluated to zero.",
      "location": "return a / b",
      "explanation": "In mathematics and programming, division by zero is undefined...",
      "suggestion": "Add a conditional check before dividing (e.g. if b == 0)...",
      "correctedCode": "def divide(a, b):\n    if b == 0:\n        return 'Cannot divide by zero'\n    return a / b\n\nprint(divide(10, 0))"
    }
  }
  ```
* **Success Response (Clean Code Execution):** `200 OK`
  ```json
  {
    "success": true,
    "result": {
      "status": "success",
      "errorType": null,
      "errorMessage": null,
      "output": "Result: 5\n",
      "executionTime": 0.03,
      "submissionId": 2
    },
    "explanation": null
  }
  ```
* **Error Response:** `400` / `500` / `503`
  ```json
  {
    "success": false,
    "message": "Descriptive error message"
  }
  ```

### 2.2 `GET /api/submissions`
* **Purpose:** Retrieve the last 50 debugging attempts for the history sidebar.
* **Headers:** Standard GET (no body).
* **Success Response:** `200 OK`
  ```json
  [
    {
      "id": 2,
      "language": "python",
      "errorType": null,
      "status": "success",
      "createdAt": "2026-11-18T10:00:00.000Z"
    },
    {
      "id": 1,
      "language": "python",
      "errorType": "ZERO_DIVISION_ERROR",
      "status": "error",
      "createdAt": "2026-11-18T09:55:00.000Z"
    }
  ]
  ```

### 2.3 `GET /api/submissions/:id`
* **Purpose:** Retrieve complete details of a specific submission for loading into the editor and analysis panel.
* **Parameters:** `id` (integer in URL path).
* **Validation:** If `id` is not a valid integer, return `400 Bad Request`.
* **Not Found:** If submission does not exist, return `404 Not Found`.
* **Success Response:** `200 OK`
  ```json
  {
    "success": true,
    "submission": {
      "id": 1,
      "code": "def divide(a, b):\n    return a / b\n\nprint(divide(10, 0))",
      "language": "python",
      "createdAt": "2026-11-18T09:55:00.000Z"
    },
    "result": {
      "status": "error",
      "errorType": "ZERO_DIVISION_ERROR",
      "errorMessage": "division by zero",
      "output": "",
      "executionTime": 0.04,
      "memory": 12840
    },
    "explanation": {
      "summary": "The program attempted to divide a number by zero.",
      "cause": "A division operation was executed where the denominator evaluated to zero.",
      "location": "return a / b",
      "explanation": "In mathematics and programming, division by zero is undefined...",
      "suggestion": "Add a conditional check before dividing...",
      "correctedCode": "def divide(a, b):\n    ..."
    }
  }
  ```

---

## 3. Data Architecture & Persistence

### 3.1 Database Schema (Prisma)
The website backend utilizes the existing models in `backend/prisma/schema.prisma`:
* `User`: Identified by seeded demo user `demo@bugify.dev` (ID: 1).
* `Language`: Identifies runtime language (`python`).
* `Submission`: Stores code and links user, language, and optional problem.
* `SubmissionResult`: Stores execution telemetry (status, errorType, output, executionTime, stderr).
* `DebuggingExplanation`: Stores AI/mentor explanation linked to `SubmissionResult`.
* `UserProgress`: Updated atomically in the transaction (`totalSubmissions`, `successfulSubmissions`, `failedSubmissions`).

### 3.2 Transaction Integrity
All records created during a submission (`Submission`, `SubmissionResult`, `DebuggingExplanation`, and `UserProgress` update) must execute inside an atomic `prisma.$transaction`.

---

## 4. Execution & Explanation Resilience Strategy

1. **Code Execution:**
   * Primary: Judge0 API (`https://ce.judge0.com` or configured `JUDGE0_API_URL`).
   * Fallback: If Judge0 returns connection refused, timeout, HTTP 429, or HTTP 5xx, gracefully fall back to local/heuristic execution (`executionService.js`) so the submission succeeds and the user receives feedback.
2. **AI Explanation:**
   * Primary: Gemini / OpenAI API using `AI_API_KEY`.
   * Fallback: If AI is not configured or fails, use the rule-based heuristic mentor (`generateHeuristicExplanation`) in `aiExplanationService.js`.
3. **Data Privacy:**
   * Sensitive credentials (API keys, tokens, passwords) in user code must be redacted via `redactService.js` prior to storage and AI prompting.

---

## 5. Verification Standards

Per `PROJECT_RULES.md`, every implementation step must be verified with empirical command output:
* Endpoint behavior proven via `curl` command output.
* Database operations proven via Prisma script execution output.
* Test suite passing proven via `node --test` output.

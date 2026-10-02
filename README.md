# Bugify

**Understand your bugs. Track your mistakes. Write better code.**

Bugify is a code debugging and error-understanding platform that helps developers understand **why their code failed**, rather than simply showing that it failed.

It is designed to work with code written on the Bugify website and, eventually, through a browser extension that can work alongside online coding platforms and web-based code editors.

---

##  The Idea

When code doesn't work, developers usually see an error message and have to figure out what it means themselves.

Bugify aims to turn this:

```text
Write Code
    ↓
Run / Submit
    ↓
 Error
    ↓
Search the Error
    ↓
Try to Understand It
```

into:

```text
Write Code
    ↓
Run / Submit
    ↓
 Bugify detects the error
    ↓
Understand what went wrong
    ↓
Track the debugging attempt
    ↓
Identify recurring mistakes
    ↓
Improve
```

---

##  Core Features

### 1. Code Execution

Users can write or submit code and execute it through Bugify.

### 2. Error Detection

Bugify identifies information such as:

* Error type
* Error message
* Output
* Execution status
* Execution time

### 3. Error Explanation

Instead of only displaying an error, Bugify will explain what happened and help the developer understand the cause.

### 4. Debugging History

Previous submissions and debugging attempts are stored so users can review their mistakes.

### 5. Failure Pattern Detection

Bugify can eventually identify recurring mistakes such as:

* Index errors
* Null/undefined errors
* Infinite loops
* Syntax errors
* Wrong conditions
* Incorrect base cases
* Off-by-one errors

### 6. Progress Tracking

The system can track a user's debugging activity and identify areas where they repeatedly struggle.

### 7. Browser Extension

A future browser extension will allow Bugify to work alongside:

* Online coding platforms
* Web-based code editors
* Other supported coding environments

The extension will provide relevant debugging information without requiring users to leave their coding environment.

---

#  System Workflow

```text
             ┌───────────────┐
             │     User      │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │   Frontend    │
             │    React      │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │   REST API    │
             │    Express    │
             └───────┬───────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
 ┌─────────────────┐   ┌─────────────────┐
 │ Code Execution  │   │    PostgreSQL   │
 │     Engine      │   │    Database     │
 └────────┬────────┘   └────────┬────────┘
          │                     │
          └──────────┬──────────┘
                     ▼
             ┌───────────────┐
             │ Bug / Result  │
             │ Explanation   │
             └───────────────┘
```

---

#  Tech Stack

| Layer             | Technology                         |
| ----------------- | ---------------------------------- |
| Frontend          | React + Vite                       |
| Backend           | Node.js + Express                  |
| Database          | PostgreSQL                         |
| ORM               | Prisma                             |
| API               | REST                               |
| Code Execution    | Planned external execution service |
| AI Explanation    | Planned                            |
| Browser Extension | Planned                            |

---

#  Project Structure

```text
bugify/
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── server.js
│   │
│   ├── prisma/
│   │   └── schema.prisma
│   │
│   └── package.json
│
├── extension/
│   └── README.md
│
├── README.md
├── .env.example
└── .gitignore
```

---

#  Database

The database is designed around the debugging lifecycle.

Core entities currently planned:

```text
Users
  │
  ├── Submissions
  │       │
  │       └── Submission Results
  │
  ├── User Progress
  │
  └── Problem Attempts
          
Problems
  │
  └── Test Cases

Languages
  │
  └── Submissions
```

### Main Tables

* `users`
* `problems`
* `languages`
* `submissions`
* `submission_results`
* `test_cases`
* `user_progress`

Additional entities will be added as the system evolves.

---

#  Current API

### Health Check

```http
GET /api/health
```

Used to verify that the Bugify backend is running.

### Submit Code

```http
POST /api/submissions
```

Example request:

```json
{
  "code": "print(10/0)",
  "language": "python"
}
```

Example response:

```json
{
  "status": "error",
  "errorType": "ZeroDivisionError",
  "errorMessage": "division by zero",
  "output": null,
  "executionTime": 0
}
```

---

#  Local Setup

## 1. Clone the repository

```bash
git clone <repository-url>
cd bugify
```

## 2. Install dependencies

### Backend

```bash
cd backend
npm install
```

### Frontend

```bash
cd frontend
npm install
```

---

## 3. Configure environment variables

Create:

```text
backend/.env
```

Example:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/bugify"
PORT=5000
```

Never commit your actual `.env` file.

---

## 4. Setup Prisma

From the backend directory:

```bash
npx prisma generate
```

Then run the database migration:

```bash
npx prisma migrate dev --name init
```

---

## 5. Start the backend

```bash
npm run dev
```

The backend should run on:

```text
http://localhost:5000
```

Test:

```text
GET http://localhost:5000/api/health
```

---

## 6. Start the frontend

Open another terminal:

```bash
cd frontend
npm run dev
```

The frontend will be available at the Vite development URL shown in the terminal.

---

#  MVP

The first MVP focuses on proving the complete debugging pipeline:

```text
React UI
   ↓
Submit Code
   ↓
Express API
   ↓
Prisma
   ↓
PostgreSQL
   ↓
Execution Result
   ↓
Display Error
```

Once this pipeline is stable, additional capabilities can be added without rebuilding the foundation.

---

#  Future Development

Planned features include:

* Real code execution
* AI-powered error explanations
* Test case execution
* Execution time measurement
* Complexity tracking
* Debugging history
* Failure-pattern detection
* Weak-area identification
* Problem recommendations
* User progress dashboard
* Browser extension
* Dynamic debugging overlay
* Support for multiple programming languages

---

#  Vision

Bugify is designed around a simple idea:

> **Don't just fix the bug. Understand why you made it.**

The goal is to turn debugging from a frustrating interruption into a learning process.

---

##  Project Status

**Development started — MVP in progress.**

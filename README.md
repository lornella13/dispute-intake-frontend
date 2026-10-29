# Dispute Intake Module — Frontend

React + TypeScript + Vite frontend for Aline's Task B: Dispute Intake Module.
Provides operator login, complaint creation with validation, complaint queue,
and complaint detail views. Communicates with the FastAPI backend over HTTP.

## Prerequisites

- Node.js 18+
- npm (bundled with Node)

## Installation

```bash
cd /home/Student/dispute-intake/frontend
npm install
```

## Local Development

```bash
cd /home/Student/dispute-intake/frontend

# 1. Configure environment
cp .env.example .env
# Edit .env to set VITE_API_BASE (e.g. http://localhost:8000)

# 2. Start the dev server
npm run dev

# 3. Open the app
# http://localhost:5173 (or the port Vite reports)
```

## Environment Configuration

Copy `.env.example` to `.env`. Vite only exposes variables prefixed with
`VITE_` to client-side code.

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_BASE` | Base URL of the backend API | `http://localhost:8000` |

### `.env.example`

```ini
VITE_API_BASE=
```

Set `VITE_API_BASE` to your backend URL. For local development with the backend
running on port 8000, use `http://localhost:8000`.

## Build

```bash
npm run build
```

Runs TypeScript type-checking (`tsc`) followed by Vite production build.
Output goes to `dist/`.

## Lint

```bash
npm run lint
```

Note: The project pins TypeScript 7.0.x, which has a known incompatibility
with the installed `typescript-eslint` version. The lint command may report
this toolchain incompatibility. The `tsc` type-check in `npm run build`
passes successfully.

## Test Commands

No automated test suite is configured for the frontend. Manual testing is
recommended against a locally running backend.

## Architecture

```
Browser (React + Vite)
    |
    | HTTPS / HTTP (fetch)
    v
FastAPI Backend (src.main:app)
    |
    |-- POST /auth/login          -> JWT-like signed token
    |-- POST /complaints/validate -> Validation only, no side effects
    |-- POST /complaints          -> Create complaint + hub registration
    |-- GET /complaints           -> Bank-isolated complaint list
    |-- GET /complaints/{id}      -> Bank-guarded complaint detail
    |-- GET /health               -> Health check
    |
    v
SQLite (disputes.db)
```

## Key Design Decisions

### Authentication
- Bearer tokens obtained from `POST /auth/login` are stored in `localStorage`
  (`op_token` and `op_bank`).
- **Security limitation**: `localStorage` is vulnerable to XSS attacks.
  HttpOnly cookies would be more secure but require backend cookie-setting
  support not present in the current architecture.
- The backend is authoritative for operator identity and bank. The bank value
  read from storage is used only for display and is never sent to the backend
  as an authorization decision.
- Tokens are never logged to the browser console.

### Complaint Submission
- The frontend calls `POST /complaints/validate` before submission to catch
  validation errors early. Backend validation failures on `POST /complaints`
  are still handled gracefully.
- Transfer reference must match `^TXN-\d{6}$`.
- Amount must be a positive decimal string (e.g. `"15000"` or `"15000.50"`).
- Evidence is required for `wrong_recipient` and `scam` categories.
- The file picker captures only the filename. No file upload endpoint exists;
  the backend stores only the filename string as a reference.

### Error Handling
- Backend error responses use `{ "error_code": "...", "message": "..." }`.
- The frontend extracts `message` (or falls back to `error_code`) and
  displays it to the user.
- 401/403 responses trigger logout and redirect to the login screen.
- Network failures show a generic "Cannot connect to the backend" message.

### Queue and Detail
- `GET /complaints` is filtered server-side by the authenticated operator's
  bank. The frontend displays all returned records.
- Queue refresh re-fetches the list and preserves the selected complaint if
  it still exists.
- `GET /complaints/{id}` is used for complaint details. Cross-bank reads
  return 404 from the backend.

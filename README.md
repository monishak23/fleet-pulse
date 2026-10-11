# Fleet Pulse

Fleet Pulse is a real-time ops dashboard that monitors a 2,000-service fleet in Angular and exercises a resilient live stream with a mock backend.

This repository contains:

- `frontend/` — Angular 22 app for the Fleet dashboard, auth, live tables, rules, settings, and charting
- `backend/` — Node.js + Koa mock backend that implements the required API contract, including chaos switches and live streaming

## Quick start

Prerequisites:

- Node.js 20 LTS or newer
- npm 10+
- Docker (optional, for Compose)

### Run the backend

```powershell
cd backend
npm ci
npm start
```

The mock API runs on `http://localhost:4000`.

### Run the frontend

```powershell
cd frontend
npm ci
npm start
```

Open `http://localhost:4200`.

Demo accounts:

- Operator: `operator@pulse.dev` / `pulse123`
- Viewer: `viewer@pulse.dev` / `pulse123`

### Run with Docker Compose

From the repository root:

```powershell
docker compose up --build
```

This starts the frontend and backend together.

## Documentation

- Frontend docs: [frontend/README.md](./frontend/README.md)
- Backend docs: [backend/README.md](./backend/README.md)


## Architecture overview

```text
Browser / Angular app
  ├─ Auth service + interceptor
  ├─ Fleet table (virtualized, URL-synced filters/sort/search)
  ├─ Service detail charts (history + live stream)
  ├─ Rules form + eval engine
  ├─ Settings/preferences
  └─ Connection manager / transport fallback pipeline
          │
          ▼
      Stream abstraction
        ├─ WebSocket (primary)
        ├─ SSE
        └─ Polling fallback
          │
          ▼
      Mock backend (Node.js / Koa)
        ├─ /auth/login and /auth/refresh
        ├─ /metrics/snapshot, /metrics/history, /metrics/replay
        ├─ /rules API and /rules/check-name
        ├─ /chaos and health endpoints
        └─ WS /stream and /stream/sse
```


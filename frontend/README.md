# Fleet Pulse Frontend

This folder holds the Angular frontend for Fleet Pulse, a live monitoring console for a 2,000-service fleet. The UI is designed to stay usable under stream failures, stale data, out-of-order events, token expiry storms, and heavy live traffic.

## Quick start

Prerequisites:

- Node.js 20 LTS or newer
- npm 10+
- A running mock backend on `http://localhost:4000`

### Install and run

```powershell
cd frontend
npm ci
npm start
```

Then open:

- `http://localhost:4200`

### Demo accounts

Both accounts use password `pulse123`:

| Role | Email | Notes |
| --- | --- | --- |
| Operator | `operator@pulse.dev` | Can access Fleet, Settings, and Rules |
| Viewer | `viewer@pulse.dev` | Can access Fleet and Settings, but not Rules |

Tokens are kept in memory only; a refresh reload requires the user to sign back in.

## Setup and verification commands

```powershell
cd frontend
npm ci
npm run lint
npm run build
npm test -- --watch=false
```

## Architecture

```text
Angular app
  ├─ Login + auth guard / role guard
  ├─ Http interceptor (token refresh + retry policy)
  ├─ Connection manager
  │    ├─ WebSocket transport
  │    ├─ SSE transport
  │    └─ Polling transport
  ├─ Stream processor
  │    ├─ sequence handling
  │    ├─ duplicate drop
  │    ├─ out-of-order replay
  │    └─ stale-data detection
  ├─ Fleet table (URL-backed search/sort/filter)
  ├─ Service detail charts
  ├─ Rules form and rule evaluator
  ├─ Settings/preferences
  └─ Toolbar status + aria-live connection state
```

The code is organized by responsibility rather than by page only:

- `core/auth/` — auth, guards, token handling, refresh flow
- `core/http/` — HTTP error handling and request semantics
- `core/stream/` — connection management, transports, event processing, replay logic
- `core/rules/` — rule data, validation, and evaluation
- `core/preferences/` — local user preferences
- `features/` — page-level views and components

## Features implemented

- Live fleet table for all 2,000 services
- URL-driven search, filtering, and sorting
- In-place metric updates with visible status flash on change
- Service detail route with history and live chart updates
- Chart smoothing with capped point counts
- Rule creation and editing with custom validators and async unique-name checks
- Operator-only route enforcement for `/rules`
- Token refresh and replay flow with in-flight request coalescing
- Connection-health indicator with live / stale / reconnecting / offline states
- Browser notifications and settings-driven preferences
- Graceful fallback across transports and stale-data labeling

## Resilience decisions

### R1. Transport fallback

The app abstracts the live stream behind a transport manager so the consuming code does not know whether it is talking to WebSocket, SSE, or polling. Failover is handled by policy rather than page logic:

- WebSocket is primary
- SSE is used after repeated WebSocket failures
- Polling is the last fallback
- the system attempts to climb back to a higher-quality transport after recovery windows
- reconnect timing backs off up to a cap and resets after success
- browser offline state pauses reconnect attempts until the browser returns online

### R2. Data integrity on the stream

The stream processor validates sequence order, drops duplicates, and handles out-of-order arrivals. When a reconnect or a gap appears, the client replays missing events from `/metrics/replay?since=`. If the server reports a replay-too-old condition, the app reloads a fresh snapshot rather than pretending the data is complete.

Malformed JSON or invalid events are counted and logged without crashing the stream. The UI never shows stale numbers as if they are current.

### R3. HTTP resilience

The HTTP layer retries only safe GET requests and only on retryable failures such as network errors, 429, 502, 503, and 504. It obeys `Retry-After` on 429 and enforces a 10s request timeout. It does not retry unsafe requests or 4xx validation failures.

### R4. Graceful degradation in the UI

Failures are isolated to the component where they occur. If a chart panel fails, only that panel shows an error and a retry option; the table remains live. Errors are exposed explicitly rather than hidden behind a blank or frozen screen.

## Performance notes

The app is designed to stay responsive under load and was validated against the assignment's 4x CPU-throttle requirement.

### Measured smoke run

A 30-second Chromium run at 4x CPU slowdown and a generated stream rate of 2,000 events/s showed:

- 2,000 services loaded and still live
- maximum rendered virtual-table row count: `23`
- requirement threshold: fewer than `60` rows at any time
- browser reported `27` long tasks totaling `3.281s`

This is a realistic smoke result on the current machine; target hardware should be re-measured before production use.

### Why the app stays responsive

- Virtualized table rendering only shows the visible range and a bounded buffer
- Streaming updates are batched before UI writes
- Charts cap series length to `300` points maximum
- Data reduction happens before chart rendering, not after
- Search, sort, and filter state are URL-driven but the table remains efficient under load

## Mock backend contract

The frontend targets the mock contract provided in the assignment and expects:

- auth endpoints for login and refresh
- a live metric stream via WebSocket or SSE
- `/metrics/snapshot` and `/metrics/history` for REST access
- `/metrics/replay?since=` for gap recovery
- rules endpoints with operator-only write access
- chaos endpoints for stream and API failure drills

The backend is in the sibling `../backend` directory.

## Trade-offs and shortcuts

This version intentionally prioritizes correctness and resilience over feature bloat. The main trade-offs are:

- the mock backend is functional but not production-grade
- performance tuning is aimed specifically at the assignment's test scenarios
- some stretch items were not implemented to keep the app honest and testable

## AI usage

This work used AI-assisted coding and review tools to assist with:

- understanding the assignment brief
- generating and refining the Angular structure
- checking failure handling logic
- reviewing the code path for resilience and correctness
- polishing setup and documentation

## Testing checklist

```powershell
cd frontend
npm run lint
npm run build
npm test -- --watch=false
```

The project is expected to be run against the mock backend in `../backend`.

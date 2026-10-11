# Backend README

This folder contains the mock backend used by Fleet Pulse.

The backend is intentionally minimal but must implement the required contract for the real-time ops dashboard challenge. It runs on Node.js and uses Koa plus the Koa Router.

## Prerequisites

- Node.js 20 LTS or newer
- npm 10+

## Install and run

```powershell
cd backend
npm ci
npm start
```

The server listens on:

- API: `http://localhost:4000`
- WebSocket stream: `ws://localhost:4000/stream`
- SSE stream: `http://localhost:4000/stream/sse`

## Demo users

The mock auth layer supplies two users:

- Operator: `operator@pulse.dev` / `pulse123`
- Viewer: `viewer@pulse.dev` / `pulse123`

## Main endpoints

### Auth

- `POST /auth/login`
- `POST /auth/refresh`

### Services and metrics

- `GET /services`
- `GET /metrics/snapshot`
- `GET /metrics/history?serviceId=&minutes=`
- `GET /metrics/replay?since=`
- `WS /stream`
- `GET /stream/sse`

### Rules

- `GET /rules`
- `GET /rules/:id`
- `POST /rules`
- `PUT /rules/:id`
- `DELETE /rules/:id`
- `GET /rules/check-name?name=&excludeId=`

### Chaos and health

- `GET /chaos`
- `POST /chaos`
- `DELETE /chaos`
- `GET /health`

### Telemetry and assistant

- `POST /telemetry`
- `GET /assistant/stream?q=`

## Chaos switches

These switches can be changed via the `/chaos` API or by appending query params to stream requests.

Examples:

```powershell
curl http://localhost:4000/chaos

curl -X POST http://localhost:4000/chaos \
  -H "Content-Type: application/json" \
  -d '{"rate":2000,"ws":"down"}'

curl -X DELETE http://localhost:4000/chaos
```

Useful switches include:

- `rate` — total metric events per second, default `500`
- `ws=down` — disable WebSocket connections
- `sse=down` — disable SSE connections
- `ws=silent` — keep socket open but no data
- `chaos=shuffle,dupe` — reorder and duplicate events
- `ws=drop:20` — drop 20% of streamed metric events
- `token_ttl=5` — shorten access token lifetime
- `http=500:50` — inject 500 errors into REST requests
- `http=429` — rate-limit REST requests with `Retry-After: 2`

## Expected behavior of the mock

The mock is designed to support the failure drills in the assignment:

- stream fallback across WebSocket → SSE → polling
- replay after gaps and reconnects
- stale tokens and refresh rotation
- occasional malformed events
- duplicate and out-of-order deliveries
- REST errors and retryable status codes


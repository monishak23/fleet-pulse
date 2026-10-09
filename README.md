# Fleet Pulse mock backend

Mock backend for the Fleet Pulse take-home. It implements the API contract from the brief, including the chaos switches, so the frontend's failure handling can be tested. Backend code quality is not scored; it only has to run and behave as specified.

- **Stack:** Node.js, Koa (`koa`, `@koa/router`, `@koa/cors`, `@koa/bodyparser`), `ws`
- **Port:** 4000

## Prerequisites

- Node.js. Developed and tested locally on **Node 23.5.0**.
- The Dockerfile uses `node:22-alpine`. 
- Optional: `curl`, and `wscat` (`npm i -g wscat`) for manual WebSocket checks.

## Run locally

```bash
cd backend
npm ci          # use `npm install` if there is no lockfile yet
npm start       # http://localhost:4000
```

`npm start` runs plain `node`, so it does not reload on file changes. Restart it after editing code.

Check it is up:

```bash
curl localhost:4000/health        # {"status":"ok"}
```

## Run with Docker

```bash
cd backend
docker build -t fleet-pulse-backend .
docker run --rm -p 4000:4000 fleet-pulse-backend
```

The root `docker-compose.yml` (frontend + backend with `docker compose up --build`) is added once the frontend exists.

## Test users

Both use the password `pulse123`.

| Email | Role | Id |
|---|---|---|
| operator@pulse.dev | operator | u-1 |
| viewer@pulse.dev | viewer | u-2 |

## Chaos switches

Set globally with `POST /chaos` (merged into the current state), read with `GET /chaos`, reset with `DELETE /chaos`. No authentication is needed for these.

```bash
curl -X POST localhost:4000/chaos -H "Content-Type: application/json" -d '{"ws":"down","rate":2000}'
curl localhost:4000/chaos
curl -X DELETE localhost:4000/chaos
```

| Switch | Example body | Effect |
|---|---|---|
| `rate` | `{"rate":2000}` | Metric events per second across all services. Clamped to 1 to 5000. Default 500 |
| `ws` | `{"ws":"down"}` | New WebSocket connections refused with 503; open ones closed |
| `ws` | `{"ws":"silent"}` | WebSocket stays open but sends nothing (no events, no pings) |
| `ws` | `{"ws":"drop:20"}` | 20% of metric events are not delivered on either stream transport. Offset and seq are still used; replay still returns them |
| `sse` | `{"sse":"down"}` | New SSE connections get 503; open ones closed |
| `chaos` | `{"chaos":"shuffle,dupe"}` | Reorder events (max delay 900 ms) and/or duplicate about 10% of events |
| `chaos` | `{"chaos":"garbage:5"}` | 5% of metric frames are corrupted (truncated JSON or a missing required field) |
| `token_ttl` | `{"token_ttl":5}` | Lifetime in seconds of access tokens issued from now on |
| `http` | `{"http":"500:50"}` | 50% of REST requests return 500 |
| `http` | `{"http":"slow:800"}` | REST responses delayed by 800 ms |
| `http` | `{"http":"429"}` | REST requests return 429 with `Retry-After: 2` |
| `kill` | `{"kill":10}` | Every WebSocket and SSE connection is closed every 10 s |

Values can be combined: `{"chaos":"shuffle,dupe,garbage:5"}` or `{"http":"500:30,slow:200"}`.

### Per-connection overrides

Query parameters on `/stream` and `/stream/sse` apply to that one connection and override the global value. Supported keys: `ws`, `sse`, `chaos`, `kill`.

```
ws://localhost:4000/stream?access_token=<token>&ws=drop:20
http://localhost:4000/stream/sse?access_token=<token>&chaos=shuffle,dupe
```

`rate`, `http` and `token_ttl` are global only.

## Checking the stream

`scripts/check-stream.mjs` connects over SSE and prints counts of metrics, pings, malformed frames, duplicates, out-of-order events and missing offsets.

```bash
node scripts/check-stream.mjs "<query string>" [seconds]
node scripts/check-stream.mjs "" 6
node scripts/check-stream.mjs "ws=drop:20" 5
node scripts/check-stream.mjs "chaos=shuffle,dupe" 5
node scripts/check-stream.mjs "chaos=garbage:5" 5
node scripts/check-stream.mjs "sse=down" 5
```

On Git Bash for Windows, `node` may be aliased to `winpty node`. Use `command node ...` if you see "stdin is not a tty".

## Design notes

- **History is computed on demand.** `GET /metrics/history` calls a deterministic function of (service, second), so nothing is stored. Storing 2,000 services x 3,600 s would be about 7.2 million points. Live events use the same function, so live points continue smoothly from history. Trade-off: history is not "recorded" data.
- **Generator ticks every 50 ms** and emits `rate x 0.05` events per tick, with a fractional carry so the average rate is exact. Services are picked round-robin.
- **Generation and delivery are separate.** The generator always updates the snapshot store and the replay buffer. Chaos (drop, shuffle, dupe, garbage, silent) is applied only on the delivery side in one function, so replay and snapshot stay correct.
- **Replay buffer** keeps the last 6 minutes (the contract minimum is 5).
- **Tokens** are random UUIDs in server memory. Expired access tokens are kept so the server can answer `token_expired` instead of `token_invalid`.

## Choices where the contract is silent

- **Auth:** missing email or password on login returns `400 bad_request`. Missing `refreshToken` returns `400 bad_request`. The viewer's user id is `u-2`.
- **History:** `minutes` defaults to 15 when omitted. Missing `serviceId` or `minutes` outside 1 to 60 returns `422 validation`. Unknown service returns `404 not_found`.
- **Replay:** missing or invalid `since` returns `422 validation`. A `since` greater than the current offset returns an empty `events` array.
- **Streams:** a bad WebSocket token completes the handshake and then closes with code 4401 (reason text is `token_invalid` or `token_expired`). Other upgrade paths are destroyed. SSE sends a `: connected` comment first. There is no `Last-Event-ID` resume.
- **Garbage:** applied to metric frames only; pings are never corrupted. On SSE the `event:` and `id:` lines stay valid and only the `data:` payload is corrupted.
- **Shuffle and dupe:** delays are random from 0 to 900 ms. A duplicate is a delayed second copy.
- **Kill:** each connection is closed `n` seconds after it opens (re-armed when the switch changes).
- **REST chaos:** the stream endpoints and `OPTIONS` preflights are excluded in addition to `/auth/*`, `/chaos` and `/health`. Order is delay, then 429, then random 500. CORS runs before it, so injected errors still carry CORS headers.
- **Rules:** names are compared trimmed and case-insensitively. A rule needs a non-empty `name` and at least one condition with `metric` in `p95|errRate|rps`, `operator` in `>|>=|<|<=`, numeric `threshold`, and numeric `durationSec` >= 0. Ids are `r-1`, `r-2`, and so on, and the list starts empty. PUT replaces the whole rule. Role is checked before validation. A POST without `Idempotency-Key` is accepted but not deduplicated. Only 201 responses are stored for idempotent replay.

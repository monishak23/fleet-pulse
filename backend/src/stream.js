import Router from '@koa/router';
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { getChaos } from './chaos.js';
import { apiError } from './error.js';
import { generatorEvents } from './generator.js';

const PING_MS = 5000;
const DRAIN_MS = 20;
const MAX_DELAY_MS = 900; // contract: no event delayed by more than 1 s
const DUPE_RATE = 0.1;
const OVERRIDE_KEYS = ['ws', 'sse', 'chaos', 'kill'];
const REQUIRED_FIELDS = ['offset', 'serviceId', 'seq', 'ts', 'p95', 'errRate', 'rps', 'status'];

// Every open client. Shape:
// { transport: 'ws'|'sse', send(event, rawText?), close(code?, reason?), overrides, pending, timers, killTimer }
export const connections = new Set();

// ---------- chaos resolution ----------

const overridesFrom = (params) => {
  const o = {};
  for (const k of OVERRIDE_KEYS) if (params.has(k)) o[k] = params.get(k);
  return o;
};

// Per-connection query params override the global value
const resolve = (conn) => ({ ...getChaos(), ...conn.overrides });

const isDown = (transport, c) => (transport === 'ws' ? c.ws === 'down' : c.sse === 'down');

function parseFlags(c) {
  const list = Array.isArray(c.chaos)
    ? c.chaos.map(String)
    : String(c.chaos ?? '').split(',').map((s) => s.trim());
  const garbage = list.find((s) => s.startsWith('garbage:'));
  const drop = /^drop:(\d+(?:\.\d+)?)$/.exec(String(c.ws ?? ''));
  return {
    shuffle: list.includes('shuffle'),
    dupe: list.includes('dupe'),
    garbagePct: garbage ? Number(garbage.slice('garbage:'.length)) || 0 : 0,
    dropPct: drop ? Number(drop[1]) : 0,
  };
}

// Returns the corrupted frame text. Two kinds, 50/50: truncated JSON, or a missing required field.
function garble(event) {
  if (Math.random() < 0.5) {
    const text = JSON.stringify(event);
    return text.slice(0, Math.max(1, Math.floor(text.length * (0.3 + Math.random() * 0.5))));
  }
  const copy = { ...event };
  delete copy[REQUIRED_FIELDS[Math.floor(Math.random() * REQUIRED_FIELDS.length)]];
  return JSON.stringify(copy);
}

function emit(conn, event, garbagePct) {
  if (garbagePct > 0 && Math.random() * 100 < garbagePct) conn.send(event, garble(event));
  else conn.send(event);
}

// ---------- delivery: the single place that decides what a client receives ----------

export function deliverBatch(conn, batch) {
  const c = resolve(conn);
  if (conn.transport === 'ws' && c.ws === 'silent') return;
  const f = parseFlags(c);
  const now = Date.now();

  for (const event of batch) {
    if (f.dropPct && Math.random() * 100 < f.dropPct) continue; // offset/seq already consumed

    const copies = f.dupe && Math.random() < DUPE_RATE ? 2 : 1;
    for (let n = 0; n < copies; n++) {
      // With shuffle every event is delayed randomly; a duplicate copy is always delayed.
      if (f.shuffle || n > 0) {
        conn.pending.push({ at: now + Math.random() * MAX_DELAY_MS, event, garbagePct: f.garbagePct });
      } else {
        emit(conn, event, f.garbagePct);
      }
    }
  }
}

// Sends delayed events whose time has come, in due-time order
function drain(conn) {
  if (!conn.pending.length) return;
  if (conn.transport === 'ws' && resolve(conn).ws === 'silent') {
    conn.pending = [];
    return;
  }
  const now = Date.now();
  const due = [];
  const rest = [];
  for (const p of conn.pending) (p.at <= now ? due : rest).push(p);
  conn.pending = rest;
  due.sort((a, b) => a.at - b.at);
  for (const p of due) emit(conn, p.event, p.garbagePct);
}

function sendPing(conn) {
  if (conn.transport === 'ws' && resolve(conn).ws === 'silent') return; // silent: no pings either
  conn.send({ type: 'ping', ts: Date.now() });
}

// ---------- connection lifecycle ----------

function armKill(conn) {
  clearTimeout(conn.killTimer);
  const s = Number(resolve(conn).kill);
  if (Number.isFinite(s) && s > 0) {
    conn.killTimer = setTimeout(() => conn.close(1001, 'killed'), s * 1000);
  }
}

function register(conn, overrides) {
  conn.overrides = overrides;
  conn.pending = [];
  connections.add(conn);
  conn.timers = [setInterval(() => sendPing(conn), PING_MS), setInterval(() => drain(conn), DRAIN_MS)];
  armKill(conn);
}

function unregister(conn) {
  conn.timers.forEach(clearInterval);
  clearTimeout(conn.killTimer);
  conn.pending = [];
  connections.delete(conn);
}

// Called by POST/DELETE /chaos: close connections whose transport is now down, re-arm kill timers
export function applyChaosChange() {
  for (const conn of [...connections]) {
    if (isDown(conn.transport, resolve(conn))) conn.close(1001, 'transport down');
    else armKill(conn);
  }
}

generatorEvents.on('batch', (batch) => {
  for (const conn of connections) deliverBatch(conn, batch);
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true });

function openWebSocket(ws, overrides) {
  const conn = {
    transport: 'ws',
    send(event, rawText) {
      if (ws.readyState === ws.OPEN) ws.send(rawText ?? JSON.stringify(event));
    },
    close(code = 1000, reason = '') {
      ws.close(code, reason);
    },
  };
  register(conn, overrides);
  ws.on('close', () => unregister(conn));
  ws.on('error', () => unregister(conn));
}

export function attachWebSocket(server) {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/stream') {
      socket.destroy();
      return;
    }
    const overrides = overridesFrom(url.searchParams);

    // ws=down: refuse new connections with 503
    if (isDown('ws', { ...getChaos(), ...overrides })) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('access_token');
    const result = verifyToken(token);

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!result.ok) {
        ws.close(4401, result.code); // contract: invalid token -> close code 4401
        return;
      }
      openWebSocket(ws, overrides);
    });
  });
}

// ---------- SSE ----------

export const streamRouter = new Router();

streamRouter.get('/stream/sse', (ctx) => {
  // authMiddleware already returned 401 for a bad token before we got here.
  const overrides = overridesFrom(new URLSearchParams(ctx.querystring));

  // sse=down: refuse new connections with 503
  if (isDown('sse', { ...getChaos(), ...overrides })) {
    return apiError(ctx, 503, 'unavailable', 'SSE transport is down');
  }

  ctx.respond = false; // we write to the raw response ourselves
  const { req, res } = ctx;
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const conn = {
    transport: 'sse',
    // rawText replaces the data payload (used for garbage frames); event/id lines stay valid
    send(event, rawText) {
      if (res.writableEnded || res.destroyed) return;
      const id = event.type === 'metric' ? `id: ${event.offset}\n` : '';
      res.write(`event: ${event.type}\n${id}data: ${rawText ?? JSON.stringify(event)}\n\n`);
    },
    close() {
      res.end();
    },
  };
  register(conn, overrides);
  req.on('close', () => unregister(conn));
});
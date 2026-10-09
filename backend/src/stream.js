import Router from '@koa/router';
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { generatorEvents } from './generator.js';

const PING_MS = 5000;

// Every open client (WebSocket or SSE) registers here.
// Shape: { transport: 'ws' | 'sse', send(event), close(code?, reason?) }
export const connections = new Set();

// The single place that decides what a client receives.
// Slice 6 adds drop / shuffle / dupe / garbage here.
export function deliverBatch(conn, batch) {
  for (const event of batch) conn.send(event);
}

generatorEvents.on('batch', (batch) => {
  for (const conn of connections) deliverBatch(conn, batch);
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true });

function openWebSocket(ws) {
  const conn = {
    transport: 'ws',
    send(event) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    },
    close(code = 1000, reason = '') {
      ws.close(code, reason);
    },
  };
  connections.add(conn);

  const pingTimer = setInterval(() => conn.send({ type: 'ping', ts: Date.now() }), PING_MS);
  const cleanup = () => {
    clearInterval(pingTimer);
    connections.delete(conn);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

export function attachWebSocket(server) {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/stream') {
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
      openWebSocket(ws);
    });
  });
}

// ---------- SSE ----------

export const streamRouter = new Router();

streamRouter.get('/stream/sse', (ctx) => {
  // authMiddleware already returned 401 for a bad token before we got here.
  ctx.respond = false; // we write to the raw response ourselves
  const { req, res } = ctx;
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);

  // Headers set earlier by the CORS middleware are kept by writeHead.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n'); // comment line: flushes headers to the client

  const conn = {
    transport: 'sse',
    send(event) {
      if (res.writableEnded || res.destroyed) return;
      const id = event.type === 'metric' ? `id: ${event.offset}\n` : '';
      res.write(`event: ${event.type}\n${id}data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      res.end();
    },
  };
  connections.add(conn);

  const pingTimer = setInterval(() => conn.send({ type: 'ping', ts: Date.now() }), PING_MS);
  req.on('close', () => {
    clearInterval(pingTimer);
    connections.delete(conn);
  });
});
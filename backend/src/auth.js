import Router from '@koa/router';
import { randomUUID } from 'node:crypto';
import { getChaos } from './chaos.js';
import { apiError } from './error.js';

const USERS = [
  { id: 'u-1', email: 'operator@pulse.dev', role: 'operator', password: 'pulse123' },
  { id: 'u-2', email: 'viewer@pulse.dev', role: 'viewer', password: 'pulse123' },
];

const DEFAULT_TTL_SEC = 60;

// Expired access tokens stay in the map so we can answer
// "token_expired" instead of "token_invalid".
const accessTokens = new Map(); // token -> { user, expiresAt }
const refreshTokens = new Map(); // token -> { user, used }

const publicUser = ({ id, email, role }) => ({ id, email, role });

function ttlSeconds() {
  const n = Number(getChaos().token_ttl);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}

function issueTokens(user) {
  const expiresIn = ttlSeconds();
  const accessToken = randomUUID();
  const refreshToken = randomUUID();
  accessTokens.set(accessToken, { user, expiresAt: Date.now() + expiresIn * 1000 });
  refreshTokens.set(refreshToken, { user, used: false });
  return { accessToken, refreshToken, expiresIn, user: publicUser(user) };
}

// Reused by the WebSocket upgrade handler in a later slice.
export function verifyToken(token) {
  const entry = token && accessTokens.get(token);
  if (!entry) return { ok: false, code: 'token_invalid' };
  if (Date.now() >= entry.expiresAt) return { ok: false, code: 'token_expired' };
  return { ok: true, user: entry.user };
}

const OPEN_PREFIXES = ['/auth/', '/chaos', '/health'];
const STREAM_PATHS = ['/stream', '/stream/sse', '/assistant/stream'];

export async function authMiddleware(ctx, next) {
  if (ctx.method === 'OPTIONS' || OPEN_PREFIXES.some((p) => ctx.path.startsWith(p))) {
    return next();
  }

  let token;
  const header = ctx.get('Authorization');
  if (header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length);
  } else if (STREAM_PATHS.includes(ctx.path)) {
    token = ctx.query.access_token;
  }

  const result = verifyToken(token);
  if (!result.ok) {
    const message = result.code === 'token_expired' ? 'Access token expired' : 'Access token invalid';
    return apiError(ctx, 401, result.code, message);
  }
  ctx.state.user = result.user;
  return next();
}

export const authRouter = new Router({ prefix: '/auth' });

authRouter.post('/login', (ctx) => {
  const { email, password } = ctx.request.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return apiError(ctx, 400, 'bad_request', 'email and password are required');
  }
  const user = USERS.find((u) => u.email === email && u.password === password);
  if (!user) return apiError(ctx, 401, 'invalid_credentials', 'Invalid email or password');
  ctx.body = issueTokens(user);
});

authRouter.post('/refresh', (ctx) => {
  const { refreshToken } = ctx.request.body ?? {};
  if (typeof refreshToken !== 'string') {
    return apiError(ctx, 400, 'bad_request', 'refreshToken is required');
  }
  const entry = refreshTokens.get(refreshToken);
  if (!entry || entry.used) {
    return apiError(ctx, 401, 'refresh_invalid', 'Refresh token invalid');
  }
  entry.used = true; // rotation: this token can never be used again
  ctx.body = issueTokens(entry.user);
});
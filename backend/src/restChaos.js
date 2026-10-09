import { getChaos } from './chaos.js';
import { apiError } from './error.js';

// Never affected by http chaos (contract exclusions, plus streams and preflights)
const EXCLUDED_PREFIXES = ['/auth/', '/chaos', '/health', '/stream', '/assistant/stream'];
const RETRY_AFTER_SEC = 2; // contract: Retry-After: 2

// "500:50" | "slow:200" | "429" | comma list | array
function parseHttp(value) {
  const list = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const flags = { errorPct: 0, slowMs: 0, rateLimited: false };
  for (const item of list) {
    let m;
    if (item === '429') flags.rateLimited = true;
    else if ((m = /^500:(\d+(?:\.\d+)?)$/.exec(item))) flags.errorPct = Number(m[1]);
    else if ((m = /^slow:(\d+)$/.exec(item))) flags.slowMs = Number(m[1]);
  }
  return flags;
}

export async function restChaos(ctx, next) {
  if (ctx.method === 'OPTIONS' || EXCLUDED_PREFIXES.some((p) => ctx.path.startsWith(p))) {
    return next();
  }
  const f = parseHttp(getChaos().http);

  if (f.slowMs) await new Promise((resolve) => setTimeout(resolve, f.slowMs));

  if (f.rateLimited) {
    ctx.set('Retry-After', String(RETRY_AFTER_SEC));
    return apiError(ctx, 429, 'rate_limited', 'Too many requests');
  }
  if (f.errorPct && Math.random() * 100 < f.errorPct) {
    return apiError(ctx, 500, 'server_error', 'Injected failure');
  }
  return next();
}
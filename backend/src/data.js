export const SERVICE_COUNT = 2000;

const BASES = ['payments', 'checkout', 'search', 'auth', 'catalog', 'inventory', 'shipping',
  'notifications', 'billing', 'recommendations', 'profile', 'orders', 'cart', 'media',
  'analytics', 'gateway', 'ledger', 'pricing', 'reviews', 'messaging'];
const SUFFIXES = ['api', 'worker', 'gateway', 'db-proxy', 'cache', 'scheduler'];

// Deterministic hash -> float in [0, 1). Same inputs always give the same output.
function rand(...ints) {
  let h = 0x9e3779b9;
  for (const n of ints) {
    h = Math.imul(h ^ (n | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

export const serviceId = (i) => `svc-${String(i + 1).padStart(4, '0')}`;

// 'svc-0412' -> 411, or -1 if malformed / out of range
export function indexOfService(id) {
  const m = /^svc-(\d{4})$/.exec(id ?? '');
  if (!m) return -1;
  const n = Number(m[1]);
  return n >= 1 && n <= SERVICE_COUNT ? n - 1 : -1;
}

// Static service info. 20 bases x 6 suffixes = 120 combos; later rounds get a numeric suffix.
export const SERVICES = Array.from({ length: SERVICE_COUNT }, (_, i) => {
  const combo = i % 120;
  const round = Math.floor(i / 120);
  const base = BASES[combo % 20];
  const name = `${base}-${SUFFIXES[Math.floor(combo / 20)]}`;
  return { id: serviceId(i), name: round === 0 ? name : `${name}-${round + 1}`, team: base };
});

// Per-service baseline, so each service has its own plausible "personality"
const PROFILES = Array.from({ length: SERVICE_COUNT }, (_, i) => ({
  p95: 40 + rand(i, 1) * 260, // ms
  err: 0.1 + rand(i, 2) * 0.9, // %
  rps: 50 + rand(i, 3) * 1950,
  phase: rand(i, 4) * Math.PI * 2,
}));

export const statusFor = (p95, errRate) =>
  errRate >= 20 || p95 >= 2000 ? 'down' : errRate >= 2 || p95 >= 500 ? 'degraded' : 'healthy';

// Metrics of service `i` at unix second `tsSec`: slow wave + per-second noise,
// plus occasional 10-minute "incidents" (~3% of services) that push them to degraded/down.
export function metricAt(i, tsSec) {
  const p = PROFILES[i];
  const wave = Math.sin(tsSec / 90 + p.phase);
  const noise = rand(i, tsSec) - 0.5;
  const bucket = Math.floor(tsSec / 600);
  const incident = rand(i, bucket, 7) < 0.03;
  const severity = rand(i, bucket, 8);

  let p95 = p.p95 * (1 + 0.15 * wave + 0.2 * noise);
  let err = p.err * (1 + 0.2 * wave + 0.4 * noise);
  const rps = p.rps * (1 + 0.25 * wave + 0.2 * noise);
  if (incident) {
    p95 *= 3 + 6 * severity;
    err += 2 + 25 * severity;
  }
  p95 = Math.round(Math.max(1, p95));
  err = Math.min(100, Math.max(0, Math.round(err * 10) / 10));
  return { p95, errRate: err, rps: Math.max(0, Math.round(rps)) };
}

// Builds one MetricEvent. Slice 4's generator will reuse this.
export function makeEvent(i, offset, seq, ts) {
  const m = metricAt(i, Math.floor(ts / 1000));
  return {
    type: 'metric',
    offset,
    serviceId: serviceId(i),
    seq,
    ts,
    ...m,
    status: statusFor(m.p95, m.errRate),
  };
}

// Mutable stream state. Slice 4 will update this on every generated event.
export const store = {
  offset: 0, // global offset: +1 per generated event
  latest: [], // latest MetricEvent per service, indexed by service index
};

export function initStore(now = Date.now()) {
  store.offset = 0;
  store.latest = Array.from({ length: SERVICE_COUNT }, (_, i) => makeEvent(i, ++store.offset, 1, now));
}
initStore();
import Router from '@koa/router';
import { apiError } from './error.js';

const METRICS = ['p95', 'errRate', 'rps'];
const OPERATORS = ['>', '>=', '<', '<='];

const rules = new Map(); // id -> rule
const idempotency = new Map(); // key -> { status, body }
let nextId = 1;

const norm = (s) => String(s).trim().toLowerCase();

function nameTaken(name, excludeId) {
  const n = norm(name);
  for (const r of rules.values()) {
    if (r.id !== excludeId && norm(r.name) === n) return true;
  }
  return false;
}

// Returns an array of { field, message }
function validate(body) {
  const details = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Body must be a JSON object' }];
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    details.push({ field: 'name', message: 'name is required' });
  }
  if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
    details.push({ field: 'conditions', message: 'at least one condition is required' });
  } else {
    body.conditions.forEach((c, i) => {
      const f = (k) => `conditions[${i}].${k}`;
      if (!c || typeof c !== 'object') {
        details.push({ field: `conditions[${i}]`, message: 'must be an object' });
        return;
      }
      if (!METRICS.includes(c.metric)) details.push({ field: f('metric'), message: 'must be p95, errRate or rps' });
      if (!OPERATORS.includes(c.operator)) details.push({ field: f('operator'), message: 'must be >, >=, < or <=' });
      if (typeof c.threshold !== 'number' || !Number.isFinite(c.threshold)) {
        details.push({ field: f('threshold'), message: 'must be a number' });
      }
      if (typeof c.durationSec !== 'number' || !Number.isFinite(c.durationSec) || c.durationSec < 0) {
        details.push({ field: f('durationSec'), message: 'must be a number >= 0' });
      }
    });
  }
  return details;
}

const requireOperator = (ctx) => {
  if (ctx.state.user?.role !== 'operator') {
    apiError(ctx, 403, 'forbidden', 'Operator role required');
    return false;
  }
  return true;
};

export const rulesRouter = new Router({ prefix: '/rules' });

rulesRouter.get('/', (ctx) => {
  ctx.body = [...rules.values()];
});

// Must come before '/:id'
rulesRouter.get('/check-name', (ctx) => {
  const { name, excludeId } = ctx.query;
  if (typeof name !== 'string') {
    return apiError(ctx, 422, 'validation', 'Invalid query', [{ field: 'name', message: 'name is required' }]);
  }
  ctx.body = { available: !nameTaken(name, excludeId) };
});

rulesRouter.get('/:id', (ctx) => {
  const rule = rules.get(ctx.params.id);
  if (!rule) return apiError(ctx, 404, 'not_found', 'Rule not found');
  ctx.body = rule;
});

rulesRouter.post('/', (ctx) => {
  if (!requireOperator(ctx)) return;

  const key = ctx.get('Idempotency-Key');
  if (key && idempotency.has(key)) {
    const saved = idempotency.get(key);
    ctx.status = saved.status;
    ctx.body = saved.body;
    return;
  }

  const body = ctx.request.body;
  const details = validate(body);
  if (details.length) return apiError(ctx, 422, 'validation', 'Invalid rule', details);
  if (nameTaken(body.name)) return apiError(ctx, 409, 'name_taken', 'Rule name already exists');

  const now = Date.now();
  // Spread first so extra fields are kept; server-owned fields win
  const rule = { ...body, id: `r-${nextId++}`, createdAt: now, updatedAt: now };
  rules.set(rule.id, rule);

  ctx.status = 201;
  ctx.body = rule;
  if (key) idempotency.set(key, { status: 201, body: rule });
});

rulesRouter.put('/:id', (ctx) => {
  if (!requireOperator(ctx)) return;
  const existing = rules.get(ctx.params.id);
  if (!existing) return apiError(ctx, 404, 'not_found', 'Rule not found');

  const body = ctx.request.body;
  const details = validate(body);
  if (details.length) return apiError(ctx, 422, 'validation', 'Invalid rule', details);
  if (nameTaken(body.name, existing.id)) return apiError(ctx, 409, 'name_taken', 'Rule name already exists');

  const rule = { ...body, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
  rules.set(rule.id, rule);
  ctx.body = rule;
});

rulesRouter.delete('/:id', (ctx) => {
  if (!requireOperator(ctx)) return;
  if (!rules.delete(ctx.params.id)) return apiError(ctx, 404, 'not_found', 'Rule not found');
  ctx.status = 204;
});
import Router from '@koa/router';
import { apiError } from './error.js';
import { SERVICES, store, metricAt, indexOfService } from './data.js';
import { replaySince } from './generator.js';

export const dataRouter = new Router();

dataRouter.get('/services', (ctx) => {
  ctx.body = SERVICES.map((s, i) => ({ ...s, status: store.latest[i].status }));
});

dataRouter.get('/metrics/snapshot', (ctx) => {
  ctx.body = { offset: store.offset, ts: Date.now(), metrics: store.latest };
});

dataRouter.get('/metrics/history', (ctx) => {
  const { serviceId, minutes: rawMinutes } = ctx.query;
  const minutes = rawMinutes === undefined ? 15 : Number(rawMinutes);

  const details = [];
  if (!serviceId) details.push({ field: 'serviceId', message: 'serviceId is required' });
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    details.push({ field: 'minutes', message: 'minutes must be an integer from 1 to 60' });
  }
  if (details.length) return apiError(ctx, 422, 'validation', 'Invalid query', details);

  const i = indexOfService(serviceId);
  if (i < 0) return apiError(ctx, 404, 'not_found', `Unknown service ${serviceId}`);

  // One point per second, ending at the current second
  const endSec = Math.floor(Date.now() / 1000);
  const count = minutes * 60;
  const points = [];
  for (let k = count - 1; k >= 0; k--) {
    const sec = endSec - k;
    points.push({ ts: sec * 1000, ...metricAt(i, sec) });
  }
  ctx.body = { serviceId, points };
});

dataRouter.get('/metrics/replay', (ctx) => {
  const since = Number(ctx.query.since);
  if (ctx.query.since === undefined || !Number.isInteger(since) || since < 0) {
    return apiError(ctx, 422, 'validation', 'Invalid query', [
      { field: 'since', message: 'since must be a non-negative integer' },
    ]);
  }
  const events = replaySince(since);
  if (events === null) {
    return apiError(ctx, 410, 'replay_too_old', 'Requested offset is no longer available');
  }
  ctx.body = { events, offset: store.offset };
});
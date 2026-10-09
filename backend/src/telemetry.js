import Router from '@koa/router';
import { apiError } from './error.js';

export const telemetryRouter = new Router();

telemetryRouter.post('/telemetry', (ctx) => {
  const errors = ctx.request.body?.errors;
  if (!Array.isArray(errors)) {
    return apiError(ctx, 422, 'validation', 'Invalid body', [
      { field: 'errors', message: 'errors must be an array' },
    ]);
  }
  for (const e of errors) console.log('[telemetry]', e?.message, e?.url);
  ctx.status = 202;
});
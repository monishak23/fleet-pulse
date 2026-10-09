import http from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import { bodyParser } from '@koa/bodyparser';
import { getChaos, mergeChaos, resetChaos } from './chaos.js';
import { apiError } from './error.js';
import { authMiddleware, authRouter } from './auth.js';

const app = new Koa();

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
    apiError(ctx, 500, 'server_error', 'Internal server error');
  }
});

// exposeHeaders lets the browser read Retry-After later (needed for 429 handling)
app.use(cors({ exposeHeaders: ['Retry-After'] }));
app.use(bodyParser());
app.use(authMiddleware);

const router = new Router();
router.get('/health', (ctx) => { ctx.body = { status: 'ok' }; });
router.get('/chaos', (ctx) => { ctx.body = getChaos(); });
router.post('/chaos', (ctx) => { ctx.body = mergeChaos(ctx.request.body); });
router.delete('/chaos', (ctx) => { ctx.body = resetChaos(); });

// TEMPORARY: remove once /services exists (slice 3), so we can test the auth middleware
router.get('/whoami', (ctx) => { ctx.body = ctx.state.user; });

app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(router.routes()).use(router.allowedMethods());

export const server = http.createServer(app.callback());
server.listen(4000, () => console.log('mock backend on :4000'));
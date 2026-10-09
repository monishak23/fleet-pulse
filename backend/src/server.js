import http from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import { bodyParser } from '@koa/bodyparser';

export const DEFAULT_CHAOS = { rate: 500 };
export let chaos = { ...DEFAULT_CHAOS };

// Contract error shape: { error: { code, message, details } }
export const apiError = (ctx, status, code, message, details = []) => {
    ctx.status = status;
    ctx.body = { error: { code, message, details } };
};

const app = new Koa();

// Catch anything unexpected and answer in the contract's error shape
app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        console.error(err);
        apiError(ctx, 500, 'server_error', 'Internal server error');
    }
});

app.use(cors()); // contract: allow the frontend's origin
app.use(bodyParser());

const router = new Router();

router.get('/health', (ctx) => {
    ctx.body = { status: 'ok' };
});
router.get('/chaos', (ctx) => {
    ctx.body = chaos;
});
router.post('/chaos', (ctx) => {
    chaos = { ...chaos, ...ctx.request.body };
    ctx.body = chaos;
});
router.delete('/chaos', (ctx) => {
    chaos = { ...DEFAULT_CHAOS };
    ctx.body = chaos;
});

app.use(router.routes()).use(router.allowedMethods());


export const server = http.createServer(app.callback());
server.listen(4000, () => console.log('mock backend on :4000'));
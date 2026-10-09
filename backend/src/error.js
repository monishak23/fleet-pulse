// Contract error shape: { error: { code, message, details } }
export const apiError = (ctx, status, code, message, details = []) => {
  ctx.status = status;
  ctx.body = { error: { code, message, details } };
};
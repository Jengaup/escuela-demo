import { Router } from './router.js';
import { json, HttpError, clientIp } from './http.js';
import { getSessionUser } from './auth.js';
import * as auth from './routes/auth.js';
import * as users from './routes/users.js';
import * as checkin from './routes/checkin.js';

const router = new Router();
for (const mod of [auth, users, checkin]) mod.register(router);

export async function handleApi(request, env) {
  const url = new URL(request.url);
  try {
    const { route, params, pathMatched } = router.match(request.method, url.pathname);
    if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Método no permitido' : 'Ruta no encontrada');

    const ctx = { request, env, url, params, ip: clientIp(request), user: null };
    ctx.user = await getSessionUser(request, env);
    if (!route.opts.public && !ctx.user) throw new HttpError(401, 'Sesión expirada. Vuelve a iniciar sesión.');

    return await route.handler(ctx);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, details: err.details }, err.status);
    console.error('API error', err?.stack || err);
    const msg = String(err?.message || '');
    if (msg.includes('UNIQUE constraint failed')) return json({ error: 'Registro duplicado' }, 409);
    if (msg.includes('FOREIGN KEY constraint failed')) return json({ error: 'Referencia inválida o registro en uso' }, 409);
    return json({ error: 'Error interno del servidor' }, 500);
  }
}

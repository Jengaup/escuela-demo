import { json, readJson, HttpError } from '../http.js';
import { V } from '../validate.js';
import { verifyPassword, hashPassword } from '../crypto.js';
import { createSession, destroySession, isRateLimited, recordFailure, clearFailures } from '../auth.js';
import { audit } from '../audit.js';

// Hash ficticio para que un usuario inexistente tarde lo mismo que uno real (evita enumeración).
let dummyUser;
async function dummy() {
  if (!dummyUser) {
    const h = await hashPassword('x');
    dummyUser = { password_hash: h.hash, salt: h.salt, iterations: h.iterations };
  }
  return dummyUser;
}

export function register(r) {
  r.post('/api/auth/login', async (ctx) => {
    const v = new V(await readJson(ctx.request, 4096));
    const username = v.str('username', { required: true, max: 50, label: 'Usuario' });
    const password = v.str('password', { required: true, max: 200, label: 'Contraseña' });
    v.done();

    const keys = [`ip:${ctx.ip}`, `user:${username.toLowerCase()}`];
    if (await isRateLimited(ctx.env, keys)) {
      throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.');
    }

    const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    const ok = await verifyPassword(password, user || (await dummy()));
    if (!user || !ok || !user.active) {
      await recordFailure(ctx.env, keys);
      await audit({ ...ctx, user: null }, 'login_fallido', 'user', user?.id ?? null, { username });
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }

    await clearFailures(ctx.env, keys);
    const { cookie } = await createSession(ctx.env, user.id);
    await audit({ ...ctx, user }, 'login', 'user', user.id);
    return json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } }, 200, { 'set-cookie': cookie });
  }, { public: true });

  r.post('/api/auth/logout', async (ctx) => {
    const cookie = await destroySession(ctx.request, ctx.env);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }, { public: true });

  r.get('/api/auth/me', async (ctx) => {
    return json({ user: ctx.user, demo: ctx.env.DEMO_MODE === 'true' });
  });
}

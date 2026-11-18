import { json, readJson, badRequest, notFound } from '../http.js';
import { V, idParam } from '../validate.js';
import { hashPassword } from '../crypto.js';
import { requireAdmin } from '../auth.js';
import { auditStmt } from '../audit.js';

const PUBLIC_COLS = 'id, username, name, role, active, created_at';

function validatePassword(v, required) {
  const p = v.str('password', { required, max: 200, label: 'Contraseña' });
  if (p && p.length < 8) v.fail('password', 'La contraseña debe tener al menos 8 caracteres');
  return p;
}

export function register(r) {
  r.get('/api/users', async (ctx) => {
    requireAdmin(ctx);
    const { results } = await ctx.env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY active DESC, name`).all();
    return json({ users: results });
  });

  // Lista corta para filtros de reportes/cuadre (cualquier usuario).
  r.get('/api/users/options', async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id, name FROM users ORDER BY name').all();
    return json({ users: results });
  });

  r.post('/api/users', async (ctx) => {
    requireAdmin(ctx);
    const v = new V(await readJson(ctx.request));
    const username = v.str('username', { required: true, max: 50, min: 3, label: 'Usuario' });
    if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) v.fail('username', 'Usuario solo puede tener letras, números, punto, guion');
    const name = v.str('name', { required: true, max: 100, label: 'Nombre' });
    const role = v.oneOf('role', ['admin', 'staff'], { required: true, label: 'Rol' });
    const password = validatePassword(v, true);
    v.done();

    const exists = await ctx.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) throw badRequest('Ese usuario ya existe');

    const h = await hashPassword(password);
    const res = await ctx.env.DB.prepare(
      'INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES (?,?,?,?,?,?) RETURNING id'
    ).bind(username, name, role, h.hash, h.salt, h.iterations).first();
    await auditStmt(ctx, 'crear_usuario', 'user', res.id, { username, role }).run();
    return json({ id: res.id }, 201);
  });

  r.put('/api/users/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const v = new V(await readJson(ctx.request));
    const name = v.str('name', { required: true, max: 100, label: 'Nombre' });
    const role = v.oneOf('role', ['admin', 'staff'], { required: true, label: 'Rol' });
    const active = v.bool('active') ? 1 : 0;
    const password = validatePassword(v, false);
    v.done();

    const user = await ctx.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    if (!user) throw notFound('Usuario no encontrado');
    if (id === ctx.user.id && (role !== 'admin' || !active)) {
      throw badRequest('No puedes quitarte el rol de admin ni desactivarte a ti mismo');
    }

    const stmts = [
      ctx.env.DB.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').bind(name, role, active, id),
    ];
    if (password) {
      const h = await hashPassword(password);
      stmts.push(ctx.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?').bind(h.hash, h.salt, h.iterations, id));
    }
    // Si se desactiva o cambia la contraseña, se cierran sus sesiones.
    if (!active || password) stmts.push(ctx.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id));
    stmts.push(auditStmt(ctx, 'editar_usuario', 'user', id, { name, role, active, password_cambiada: !!password }));
    await ctx.env.DB.batch(stmts);
    return json({ ok: true });
  });
}

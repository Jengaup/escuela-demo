import { json, HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { auditStmt } from '../audit.js';
import { buildSeed } from '../seed.js';
import { todayPR } from '../time.js';

export function register(r) {
  // Borra datos (no usuarios) y recarga el demo. Solo admin y solo con DEMO_MODE=true.
  r.post('/api/admin/reset-demo', async (ctx) => {
    requireAdmin(ctx);
    if (ctx.env.DEMO_MODE !== 'true') throw new HttpError(403, 'El reseteo está deshabilitado (DEMO_MODE no es "true")');
    const db = ctx.env.DB;
    const stmts = buildSeed(todayPR()).map(({ sql, params }) => db.prepare(sql).bind(...params));
    stmts.push(auditStmt(ctx, 'reset_demo'));
    await db.batch(stmts); // una transacción: o se aplica todo o nada
    return json({ ok: true });
  });
}

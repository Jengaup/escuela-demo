import { json, readJson, HttpError, badRequest } from '../http.js';
import { requireAdmin } from '../auth.js';
import { auditStmt } from '../audit.js';
import { buildSeed } from '../seed.js';
import { todayPR } from '../time.js';

// El plan gratis de Workers permite ~50 consultas a D1 por solicitud,
// así que el reseteo se hace en pasos cortos que el navegador llama en orden.
const PER_STEP = 30;

export function register(r) {
  // Borra datos (no usuarios) y recarga el demo. Solo admin y solo con DEMO_MODE=true.
  r.post('/api/admin/reset-demo', async (ctx) => {
    requireAdmin(ctx);
    if (ctx.env.DEMO_MODE !== 'true') throw new HttpError(403, 'El reseteo está deshabilitado (DEMO_MODE no es "true")');
    const body = await readJson(ctx.request, 1024);
    const step = Number(body.step || 0);
    const all = buildSeed(body.today && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : todayPR());
    const steps = Math.ceil(all.length / PER_STEP);
    if (!Number.isInteger(step) || step < 0 || step >= steps) throw badRequest('Paso inválido');
    const db = ctx.env.DB;
    const stmts = all.slice(step * PER_STEP, (step + 1) * PER_STEP).map(({ sql, params }) => db.prepare(sql).bind(...params));
    if (step === steps - 1) stmts.push(auditStmt(ctx, 'reset_demo'));
    await db.batch(stmts);
    return json({ ok: true, step, steps, done: step === steps - 1 });
  });
}

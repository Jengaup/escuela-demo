import { json, readJson, notFound, badRequest } from '../http.js';
import { V, idParam } from '../validate.js';
import { auditStmt } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { CHARGE_KINDS, createCharge, createPayment, balance, allocate } from '../ledger.js';
import { METHODS, COURSE_LABEL_SQL } from './checkin.js';

export function register(r) {
  // Cuenta completa: cargos, pagos y saldo.
  r.get('/api/students/:id/account', async (ctx) => {
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const st = await db.prepare('SELECT id FROM students WHERE id = ?').bind(id).first();
    if (!st) throw notFound('Estudiante no encontrado');
    const [charges, payments, courses] = await db.batch([
      db.prepare(
        `SELECT cs.id, cs.kind, cs.description, cs.amount_cents, cs.due_cents, cs.local_date, cs.created_at, cs.attendance_id, u.name AS created_by
           FROM charge_status cs LEFT JOIN users u ON u.id = cs.created_by
          WHERE cs.student_id = ? ORDER BY cs.created_at DESC, cs.id DESC LIMIT 300`
      ).bind(id),
      db.prepare(
        `SELECT ps.id, ps.amount_cents, ps.free_cents, ps.method, ps.local_date, ps.created_at, ps.note, u.name AS received_by,
                (SELECT group_concat(c.description, ' + ') FROM payment_allocations pa JOIN charges c ON c.id = pa.charge_id WHERE pa.payment_id = ps.id) AS applied_to
           FROM payment_status ps JOIN users u ON u.id = ps.received_by
          WHERE ps.student_id = ? ORDER BY ps.created_at DESC, ps.id DESC LIMIT 300`
      ).bind(id),
      // Precios sugeridos para examen/matrícula según los cursos del estudiante
      db.prepare(
        `SELECT c.id, ${COURSE_LABEL_SQL} AS name, c.price_cents, c.exam_fee_cents, c.enrollment_fee_cents
           FROM enrollments e JOIN courses c ON c.id = e.course_id
           JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
          WHERE e.student_id = ? AND e.status = 'activo' ORDER BY name`
      ).bind(id),
    ]);
    return json({ ...(await balance(db, id)), charges: charges.results, payments: payments.results, courses: courses.results });
  });

  // Cargo nuevo: examen, matrícula, clase adicional u otro. Queda como deuda hasta que se pague.
  r.post('/api/charges', async (ctx) => {
    const v = new V(await readJson(ctx.request));
    const studentId = v.int('student_id', { required: true, min: 1, label: 'Estudiante' });
    const kind = v.oneOf('kind', Object.keys(CHARGE_KINDS), { required: true, label: 'Tipo de cargo' });
    const amount = v.money('amount', { required: true, max: 10000, label: 'Monto' });
    const courseId = v.int('course_id', { min: 1, label: 'Curso' });
    let description = v.str('description', { max: 120, label: 'Descripción' });
    if (amount === 0) v.fail('amount', 'El monto debe ser mayor de $0');
    v.done();
    const db = ctx.env.DB;
    const st = await db.prepare('SELECT id FROM students WHERE id = ?').bind(studentId).first();
    if (!st) throw notFound('Estudiante no encontrado');
    let courseName = '';
    if (courseId) {
      const c = await db.prepare(`SELECT ${COURSE_LABEL_SQL} AS name FROM courses c JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id WHERE c.id = ?`).bind(courseId).first();
      if (!c) throw badRequest('Curso inválido');
      courseName = c.name;
    }
    if (!description) description = [CHARGE_KINDS[kind], courseName].filter(Boolean).join(' · ');
    const id = await createCharge(ctx, { studentId, kind, description, amount, courseId });
    return json({ id, ...(await balance(db, studentId)) }, 201);
  });

  // Pago: se aplica a los cargos indicados primero y luego a lo más viejo. Lo que sobra es saldo a favor (pago adelantado).
  r.post('/api/payments', async (ctx) => {
    const body = await readJson(ctx.request);
    const v = new V(body);
    const studentId = v.int('student_id', { required: true, min: 1, label: 'Estudiante' });
    const amount = v.money('amount', { required: true, max: 10000, label: 'Monto' });
    const method = v.oneOf('method', METHODS, { required: true, label: 'Método de pago' });
    const note = v.str('note', { max: 200, label: 'Nota' });
    const clientRef = v.str('client_ref', { max: 64 });
    if (amount === 0) v.fail('amount', 'El monto debe ser mayor de $0');
    v.done();
    const priority = Array.isArray(body.apply_to) ? body.apply_to.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50) : [];
    const db = ctx.env.DB;
    const st = await db.prepare('SELECT id FROM students WHERE id = ?').bind(studentId).first();
    if (!st) throw notFound('Estudiante no encontrado');
    const id = await createPayment(ctx, { studentId, amount, method, note, clientRef, priority });
    return json({ id, ...(await balance(db, studentId)) }, 201);
  });

  // Correcciones (solo admin)
  r.delete('/api/charges/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const c = await db.prepare('SELECT id, student_id, description, amount_cents FROM charges WHERE id = ?').bind(id).first();
    if (!c) throw notFound('Cargo no encontrado');
    await db.batch([
      db.prepare('DELETE FROM payment_allocations WHERE charge_id = ?').bind(id),
      db.prepare('DELETE FROM charges WHERE id = ?').bind(id),
      auditStmt(ctx, 'anular_cargo', 'charge', id, c),
    ]);
    await allocate(db, c.student_id); // el dinero liberado se aplica a otras deudas o queda a favor
    return json({ ok: true, ...(await balance(db, c.student_id)) });
  });

  r.delete('/api/payments/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const p = await db.prepare('SELECT id, student_id, amount_cents, method, local_date FROM payments WHERE id = ?').bind(id).first();
    if (!p) throw notFound('Pago no encontrado');
    await db.batch([
      db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').bind(id),
      db.prepare('DELETE FROM payments WHERE id = ?').bind(id),
      auditStmt(ctx, 'anular_pago', 'payment', id, p),
    ]);
    await allocate(db, p.student_id);
    return json({ ok: true, ...(await balance(db, p.student_id)) });
  });
}

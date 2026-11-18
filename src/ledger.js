// Cuenta del estudiante: cargos (lo que debe) y pagos (lo que entrega).
// Los pagos se reparten entre cargos pendientes; lo que sobra queda como saldo a favor
// y se aplica solo cuando aparece un cargo nuevo (por ejemplo, la próxima clase).
import { HttpError } from './http.js';
import { auditStmt } from './audit.js';
import { todayPR } from './time.js';

export const CHARGE_KINDS = { clase: 'Clase', examen: 'Examen', matricula: 'Matrícula', otro: 'Otro' };

// Subconsultas reutilizables (requieren alias `s` para students).
export const DUE_SQL = `(SELECT IFNULL(SUM(cs2.due_cents), 0) FROM charge_status cs2 WHERE cs2.student_id = s.id)`;
export const CREDIT_SQL = `(SELECT IFNULL(SUM(ps2.free_cents), 0) FROM payment_status ps2 WHERE ps2.student_id = s.id)`;

export async function balance(db, studentId) {
  const r = await db.prepare(
    `SELECT (SELECT IFNULL(SUM(due_cents), 0) FROM charge_status WHERE student_id = ?1) AS due_cents,
            (SELECT IFNULL(SUM(free_cents), 0) FROM payment_status WHERE student_id = ?1) AS credit_cents`
  ).bind(studentId).first();
  return { due_cents: r.due_cents, credit_cents: r.credit_cents };
}

// Empareja dinero libre (pagos con sobrante) con cargos pendientes.
// `priority`: cargos que se pagan primero (ej. la clase de hoy); después, del más viejo al más nuevo.
export async function allocate(db, studentId, priority = []) {
  const [credits, open] = await db.batch([
    db.prepare('SELECT id, free_cents FROM payment_status WHERE student_id = ? AND free_cents > 0 ORDER BY created_at, id').bind(studentId),
    db.prepare('SELECT id, due_cents FROM charge_status WHERE student_id = ? AND due_cents > 0 ORDER BY created_at, id').bind(studentId),
  ]);
  const pay = credits.results.map((p) => ({ ...p }));
  const rank = (c) => { const i = priority.indexOf(c.id); return i < 0 ? priority.length : i; };
  const charges = open.results.map((c, i) => ({ ...c, i })).sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  const stmts = [];
  let p = 0;
  for (const c of charges) {
    while (c.due_cents > 0 && p < pay.length) {
      const take = Math.min(c.due_cents, pay[p].free_cents);
      // Inserción condicionada: si otra tablet aplicó dinero al mismo tiempo, no se pasa del monto.
      stmts.push(db.prepare(
        `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
         SELECT ?1, ?2, ?3 WHERE (SELECT free_cents FROM payment_status WHERE id = ?1) >= ?3
                            AND (SELECT due_cents FROM charge_status WHERE id = ?2) >= ?3`
      ).bind(pay[p].id, c.id, take));
      c.due_cents -= take;
      pay[p].free_cents -= take;
      if (!pay[p].free_cents) p++;
    }
    if (p >= pay.length) break;
  }
  if (stmts.length) await db.batch(stmts);
}

export async function createCharge(ctx, { studentId, kind, description, amount, courseId = null, attendanceId = null, localDate = todayPR() }) {
  const db = ctx.env.DB;
  const row = await db.prepare(
    `INSERT INTO charges (student_id, kind, description, amount_cents, attendance_id, course_id, local_date, created_by)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(attendance_id) DO NOTHING RETURNING id`
  ).bind(studentId, kind, description, amount, attendanceId, courseId, localDate, ctx.user.id).first();
  if (!row) return null; // ya existía (cargo de esa clase)
  await auditStmt(ctx, 'cargo', 'charge', row.id, { student_id: studentId, tipo: kind, descripcion: description, monto: amount / 100 }).run();
  await allocate(db, studentId); // si tiene saldo a favor, se aplica solo
  return row.id;
}

export async function createPayment(ctx, { studentId, amount, method, note = null, clientRef = null, priority = [] }) {
  const db = ctx.env.DB;
  const row = await db.prepare(
    `INSERT INTO payments (student_id, amount_cents, method, received_by, local_date, note, client_ref)
     VALUES (?,?,?,?,?,?,?) ON CONFLICT(client_ref) DO NOTHING RETURNING id`
  ).bind(studentId, amount, method, ctx.user.id, todayPR(), note, clientRef).first();
  if (!row) throw new HttpError(409, 'Este pago ya se registró');
  await auditStmt(ctx, 'pago', 'payment', row.id, { student_id: studentId, monto: amount / 100, metodo: method, nota: note }).run();
  await allocate(db, studentId, priority);
  return row.id;
}

// Matrícula: si el curso tiene costo de matrícula, se crea el cargo (queda como deuda hasta que paguen).
export async function enrollmentCharge(ctx, studentId, courseId) {
  const c = await ctx.env.DB.prepare(
    `SELECT c.enrollment_fee_cents AS fee, p.name || ' ' || l.name AS name FROM courses c
       JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id WHERE c.id = ?`
  ).bind(courseId).first();
  if (!c || !c.fee) return null;
  return createCharge(ctx, { studentId, kind: 'matricula', amount: c.fee, courseId, description: `Matrícula · ${c.name}` });
}

import { json, readJson, badRequest, notFound, HttpError } from '../http.js';
import { V, idParam } from '../validate.js';
import { auditStmt } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { todayPR, weekday, bandOfDay, nowIso } from '../time.js';

export const METHODS = ['efectivo', 'ath_movil', 'tarjeta'];
const MAX_SIGNATURE = 300 * 1024;

export const COURSE_LABEL_SQL = `(p.name || ' ' || l.name)`;

// Crea (si no existen) las sesiones de clase del día para los cursos activos con horario ese día.
export async function ensureSessions(env, date) {
  const wd = String(weekday(date));
  const { results } = await env.DB.prepare('SELECT id, days FROM courses WHERE active = 1').all();
  const ids = results.filter((c) => c.days.split(',').includes(wd)).map((c) => c.id);
  if (ids.length) {
    await env.DB.batch(ids.map((id) => env.DB.prepare('INSERT OR IGNORE INTO class_sessions (course_id, date) VALUES (?,?)').bind(id, date)));
  }
}

function validSignature(sig) {
  return typeof sig === 'string' && sig.length <= MAX_SIGNATURE && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(sig);
}

async function loadSession(env, id) {
  return env.DB.prepare(
    `SELECT cs.id, cs.date, c.id AS course_id, ${COURSE_LABEL_SQL} AS course_name, c.start_time, c.end_time,
            c.price_cents, c.instructor
       FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
       JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
      WHERE cs.id = ?`
  ).bind(id).first();
}

export function register(r) {
  // Clases del día con progreso.
  r.get('/api/checkin/day', async (ctx) => {
    const today = todayPR();
    const date = ctx.url.searchParams.get('date') || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Fecha inválida');
    if (date === today) await ensureSessions(ctx.env, date);
    const { results } = await ctx.env.DB.prepare(
      `SELECT cs.id, cs.date, c.id AS course_id, ${COURSE_LABEL_SQL} AS course_name, p.name AS program, l.name AS level,
              c.start_time, c.end_time, c.price_cents, c.instructor,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'activo') AS enrolled,
              (SELECT COUNT(*) FROM attendance a WHERE a.session_id = cs.id) AS signed,
              (SELECT COUNT(*) FROM attendance a JOIN payments pm ON pm.attendance_id = a.id WHERE a.session_id = cs.id) AS paid,
              (SELECT COUNT(*) FROM attendance a JOIN wristbands w ON w.attendance_id = a.id AND w.delivered = 1 WHERE a.session_id = cs.id) AS banded
         FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
         JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
        WHERE cs.date = ? ORDER BY c.start_time`
    ).bind(date).all();
    return json({ date, today, band: bandOfDay(date), sessions: results });
  });

  // Lista de matriculados (y asistentes no matriculados) de una sesión con indicadores.
  r.get('/api/checkin/session/:id', async (ctx) => {
    const id = idParam(ctx.params);
    const session = await loadSession(ctx.env, id);
    if (!session) throw notFound('Clase no encontrada');
    const { results } = await ctx.env.DB.prepare(
      `SELECT s.id, s.first_name, s.last_name, s.birth_date, s.guardian_name, s.phone, s.notes,
              a.id AS attendance_id, a.signed_by, a.signed_at,
              pm.amount_cents, pm.method, ru.name AS received_by_name,
              w.delivered AS band_delivered, w.code AS band_code
         FROM students s
         LEFT JOIN attendance a ON a.student_id = s.id AND a.session_id = ?1
         LEFT JOIN payments pm ON pm.attendance_id = a.id
         LEFT JOIN users ru ON ru.id = pm.received_by
         LEFT JOIN wristbands w ON w.attendance_id = a.id
        WHERE s.id IN (SELECT student_id FROM enrollments WHERE course_id = ?2 AND status = 'activo')
           OR a.id IS NOT NULL
        ORDER BY s.first_name, s.last_name`
    ).bind(id, session.course_id).all();
    return json({ session: { ...session, band: bandOfDay(session.date) }, students: results });
  });

  // Firma de una asistencia (imagen).
  r.get('/api/attendance/:id/signature', async (ctx) => {
    const id = idParam(ctx.params);
    const row = await ctx.env.DB.prepare('SELECT signature FROM attendance WHERE id = ?').bind(id).first();
    if (!row?.signature) throw notFound('Sin firma');
    return json({ signature: row.signature });
  });

  // Check-in: firma + pago + banda en una sola llamada. Idempotente: completa lo que falte.
  r.post('/api/checkin', async (ctx) => {
    const body = await readJson(ctx.request, 512 * 1024);
    const v = new V(body);
    const sessionId = v.int('session_id', { required: true, min: 1, label: 'Clase' });
    const studentId = v.int('student_id', { required: true, min: 1, label: 'Estudiante' });
    const signedBy = v.oneOf('signed_by', ['encargado', 'estudiante'], { label: 'Quién firma' });
    let wantBand = v.bool('wristband');
    let pay = null;
    if (body.payment) {
      const pv = new V(body.payment);
      pay = {
        method: pv.oneOf('method', METHODS, { required: true, label: 'Método de pago' }),
        amount: pv.money('amount', { required: true, max: 5000, label: 'Monto' }),
      };
      pv.done();
    }
    if (body.signature !== undefined && body.signature !== null && !validSignature(body.signature)) {
      v.fail('signature', 'Firma inválida o demasiado grande');
    }
    v.done();

    const db = ctx.env.DB;
    const today = todayPR();
    const session = await loadSession(ctx.env, sessionId);
    if (!session) throw notFound('Clase no encontrada');
    if (session.date > today) throw badRequest('No se puede hacer check-in de una clase futura');
    if (session.date < today && ctx.user.role !== 'admin') throw new HttpError(403, 'Solo un admin puede modificar clases de días anteriores');

    const student = await db.prepare('SELECT id, first_name, last_name FROM students WHERE id = ?').bind(studentId).first();
    if (!student) throw notFound('Estudiante no encontrado');

    let att = await db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').bind(sessionId, studentId).first();
    const now = nowIso();
    const stmts = [];
    const done = [];

    if (!att) {
      if (!body.signature) throw badRequest('Falta la firma');
      if (!signedBy) throw badRequest('Indica quién firma');
      att = await db.prepare(
        `INSERT INTO attendance (session_id, student_id, signature, signed_by, signed_at, recorded_by)
         VALUES (?,?,?,?,?,?) ON CONFLICT(session_id, student_id) DO NOTHING RETURNING id`
      ).bind(sessionId, studentId, body.signature, signedBy, now, ctx.user.id).first();
      if (!att) throw new HttpError(409, 'Otro usuario acaba de registrar esta asistencia. Refresca la lista.');
      done.push('firma');
    }

    const existing = done.length ? {} : await db.prepare(
      `SELECT (SELECT 1 FROM payments WHERE attendance_id = ?1) AS paid,
              (SELECT delivered FROM wristbands WHERE attendance_id = ?1) AS banded`
    ).bind(att.id).first();
    if (pay && existing.paid) throw new HttpError(409, 'Este estudiante ya pagó esta clase');
    if (wantBand && existing.banded) wantBand = false;
    if (!done.length && !pay && !wantBand) return json({ ok: true, attendance_id: att.id });

    if (pay) {
      // ON CONFLICT DO NOTHING evita cobros dobles si dos tablets confirman al mismo tiempo.
      stmts.push(db.prepare(
        `INSERT INTO payments (attendance_id, amount_cents, method, received_by, local_date)
         VALUES (?,?,?,?,?) ON CONFLICT(attendance_id) DO NOTHING`
      ).bind(att.id, pay.amount, pay.method, ctx.user.id, today));
      done.push('pago');
    }
    if (wantBand) {
      stmts.push(db.prepare(
        `INSERT INTO wristbands (attendance_id, delivered, code, delivered_by, delivered_at) VALUES (?,1,?,?,?)
         ON CONFLICT(attendance_id) DO UPDATE SET delivered = 1, delivered_by = excluded.delivered_by, delivered_at = excluded.delivered_at
         WHERE delivered = 0`
      ).bind(att.id, bandOfDay(session.date), ctx.user.id, now));
      done.push('banda');
    }
    stmts.push(auditStmt(ctx, 'checkin', 'attendance', att.id, {
      estudiante: `${student.first_name} ${student.last_name}`, clase: session.course_name, fecha: session.date, pasos: done,
      ...(pay ? { monto: pay.amount / 100, metodo: pay.method } : {}),
    }));
    await db.batch(stmts);
    return json({ ok: true, attendance_id: att.id });
  });

  // Corrección (solo admin): eliminar el check-in completo o solo el pago.
  r.delete('/api/checkin/:attendanceId', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params, 'attendanceId');
    const only = ctx.url.searchParams.get('only'); // 'pago' | null
    const att = await ctx.env.DB.prepare(
      `SELECT a.id, s.first_name || ' ' || s.last_name AS student, pm.amount_cents, pm.method
         FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN payments pm ON pm.attendance_id = a.id
        WHERE a.id = ?`
    ).bind(id).first();
    if (!att) throw notFound('Asistencia no encontrada');
    const stmts = only === 'pago'
      ? [ctx.env.DB.prepare('DELETE FROM payments WHERE attendance_id = ?').bind(id)]
      : [
          ctx.env.DB.prepare('DELETE FROM wristbands WHERE attendance_id = ?').bind(id),
          ctx.env.DB.prepare('DELETE FROM payments WHERE attendance_id = ?').bind(id),
          ctx.env.DB.prepare('DELETE FROM attendance WHERE id = ?').bind(id),
        ];
    stmts.push(auditStmt(ctx, only === 'pago' ? 'anular_pago' : 'anular_checkin', 'attendance', id, att));
    await ctx.env.DB.batch(stmts);
    return json({ ok: true });
  });
}

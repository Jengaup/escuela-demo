import { json, readJson, badRequest, notFound, HttpError } from '../http.js';
import { V, idParam, normalizeUid } from '../validate.js';
import { auditStmt } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { todayPR, weekday, bandOfDay, nowIso } from '../time.js';
import { createCharge, createPayment, balance } from '../ledger.js';

export const METHODS = ['efectivo', 'ath_movil', 'tarjeta'];
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

// Hora local de PR "HH:MM"
function nowHHMM() {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(11, 16);
}
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Si el estudiante tiene varias clases hoy, escoge la que está en curso o la más cercana.
export function pickSession(sessions, hhmm) {
  const now = toMin(hhmm);
  const current = sessions.find((s) => now >= toMin(s.start_time) - 60 && now <= toMin(s.end_time));
  if (current) return current;
  return [...sessions].sort((a, b) => Math.abs(toMin(a.start_time) - now) - Math.abs(toMin(b.start_time) - now))[0];
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

// Marca la asistencia (si falta) y crea el cargo de la clase. Si tiene saldo a favor, se aplica solo.
async function ensureAttendance(ctx, session, studentId, method) {
  const db = ctx.env.DB;
  let att = await db.prepare(
    `INSERT INTO attendance (session_id, student_id, check_in_method, recorded_by) VALUES (?,?,?,?)
     ON CONFLICT(session_id, student_id) DO NOTHING RETURNING id`
  ).bind(session.id, studentId, method, ctx.user.id).first();
  const created = !!att;
  if (!att) att = await db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').bind(session.id, studentId).first();
  if (created && session.price_cents > 0) {
    await createCharge(ctx, {
      studentId, kind: 'clase', amount: session.price_cents, courseId: session.course_id, attendanceId: att.id,
      description: `Clase ${session.course_name} · ${session.date}`, localDate: session.date,
    });
  }
  return { id: att.id, created };
}

// Estado de un estudiante en una clase: asistencia, cargo de la clase, banda y cuenta.
const STUDENT_ROW_SQL = `
  SELECT s.id, s.first_name, s.last_name, s.birth_date, s.guardian_name, s.phone, s.notes,
         (s.nfc_uid IS NOT NULL) AS has_nfc,
         EXISTS (SELECT 1 FROM student_photos sp WHERE sp.student_id = s.id) AS has_photo,
         a.id AS attendance_id, a.check_in_method, a.created_at AS checked_in_at,
         ch.id AS charge_id, ch.amount_cents AS class_cents, ch.due_cents AS class_due_cents,
         w.delivered AS band_delivered, w.code AS band_code,
         (SELECT IFNULL(SUM(x.due_cents), 0) FROM charge_status x WHERE x.student_id = s.id AND x.id IS NOT ch.id) AS other_due_cents,
         (SELECT IFNULL(SUM(ps.free_cents), 0) FROM payment_status ps WHERE ps.student_id = s.id) AS credit_cents
    FROM students s
    LEFT JOIN attendance a ON a.student_id = s.id AND a.session_id = ?1
    LEFT JOIN charge_status ch ON ch.attendance_id = a.id
    LEFT JOIN wristbands w ON w.attendance_id = a.id`;

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
              (SELECT COUNT(*) FROM attendance a WHERE a.session_id = cs.id) AS present,
              (SELECT COUNT(*) FROM attendance a JOIN charge_status ch ON ch.attendance_id = a.id WHERE a.session_id = cs.id AND ch.due_cents = 0) AS paid,
              (SELECT COUNT(*) FROM attendance a JOIN wristbands w ON w.attendance_id = a.id AND w.delivered = 1 WHERE a.session_id = cs.id) AS banded
         FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
         JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
        WHERE cs.date = ? ORDER BY c.start_time`
    ).bind(date).all();
    return json({ date, today, band: bandOfDay(date), sessions: results });
  });

  // Matriculados (y asistentes no matriculados) de una clase con indicadores.
  r.get('/api/checkin/session/:id', async (ctx) => {
    const id = idParam(ctx.params);
    const session = await loadSession(ctx.env, id);
    if (!session) throw notFound('Clase no encontrada');
    const { results } = await ctx.env.DB.prepare(
      `${STUDENT_ROW_SQL}
        WHERE s.id IN (SELECT student_id FROM enrollments WHERE course_id = ?2 AND status = 'activo') OR a.id IS NOT NULL
        ORDER BY s.first_name, s.last_name`
    ).bind(id, session.course_id).all();
    return json({ session: { ...session, band: bandOfDay(session.date) }, students: results });
  });

  // Un estudiante en una clase (para la pantalla de recepción).
  r.get('/api/checkin/session/:id/student/:sid', async (ctx) => {
    const id = idParam(ctx.params);
    const sid = idParam(ctx.params, 'sid');
    const session = await loadSession(ctx.env, id);
    if (!session) throw notFound('Clase no encontrada');
    const st = await ctx.env.DB.prepare(`${STUDENT_ROW_SQL} WHERE s.id = ?2`).bind(id, sid).first();
    if (!st) throw notFound('Estudiante no encontrado');
    return json({ session: { ...session, band: bandOfDay(session.date) }, student: st });
  });

  // Clases de hoy de un estudiante (para "Olvidó la chapita").
  r.get('/api/checkin/student/:id/today', async (ctx) => {
    const id = idParam(ctx.params);
    const today = todayPR();
    await ensureSessions(ctx.env, today);
    const { results } = await ctx.env.DB.prepare(
      `SELECT cs.id, ${COURSE_LABEL_SQL} AS course_name, c.start_time, c.end_time
         FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
         JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
         JOIN enrollments e ON e.course_id = c.id AND e.student_id = ? AND e.status = 'activo'
        WHERE cs.date = ? ORDER BY c.start_time`
    ).bind(id, today).all();
    return json({ sessions: results, suggested: results.length ? pickSession(results, nowHHMM()).id : null });
  });

  // Chapita NFC: identifica al estudiante, escoge su clase de hoy y marca la asistencia.
  r.post('/api/checkin/tap', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const uid = normalizeUid(body.uid);
    if (!uid) throw badRequest('No se pudo leer la chapita. Pásala otra vez.');
    const db = ctx.env.DB;
    const student = await db.prepare('SELECT id, first_name, last_name, active FROM students WHERE nfc_uid = ?').bind(uid).first();
    if (!student) throw new HttpError(404, 'Esta chapita no está registrada. Llama a la administración.');
    const name = `${student.first_name} ${student.last_name}`;
    if (!student.active) throw new HttpError(409, `${name} está inactivo. Llama a la administración.`);

    const today = todayPR();
    await ensureSessions(ctx.env, today);
    const { results: sessions } = await db.prepare(
      `SELECT cs.id, ${COURSE_LABEL_SQL} AS course_name, c.start_time, c.end_time
         FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
         JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
         JOIN enrollments e ON e.course_id = c.id AND e.student_id = ? AND e.status = 'activo'
        WHERE cs.date = ? ORDER BY c.start_time`
    ).bind(student.id, today).all();
    if (!sessions.length) {
      return json({ error: `${name} no tiene clase hoy.`, student_id: student.id }, 409);
    }
    const wanted = Number(body.session_id);
    const picked = sessions.find((s) => s.id === wanted) || pickSession(sessions, nowHHMM());
    const session = await loadSession(ctx.env, picked.id);
    const att = await ensureAttendance(ctx, session, student.id, 'nfc');
    if (att.created) await auditStmt(ctx, 'checkin', 'attendance', att.id, { estudiante: name, clase: session.course_name, fecha: today, entrada: 'chapita' }).run();
    return json({ student_id: student.id, session_id: session.id, attendance_id: att.id, already: !att.created, sessions });
  });

  // Check-in: asistencia + pago de la clase + banda. Idempotente: completa lo que falte.
  // Sin `payment` = "paga después": la clase queda como deuda.
  r.post('/api/checkin', async (ctx) => {
    const body = await readJson(ctx.request, 8192);
    const v = new V(body);
    const sessionId = v.int('session_id', { required: true, min: 1, label: 'Clase' });
    const studentId = v.int('student_id', { required: true, min: 1, label: 'Estudiante' });
    const wantBand = v.bool('wristband');
    let pay = null;
    if (body.payment) {
      const pv = new V(body.payment);
      pay = {
        method: pv.oneOf('method', METHODS, { required: true, label: 'Método de pago' }),
        amount: pv.money('amount', { required: true, max: 10000, label: 'Monto' }),
        clientRef: pv.str('client_ref', { max: 64 }),
      };
      if (pay.amount === 0) pv.fail('amount', 'El monto debe ser mayor de $0');
      pv.done();
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

    const att = await ensureAttendance(ctx, session, studentId, 'manual');
    if (att.created) await auditStmt(ctx, 'checkin', 'attendance', att.id, { estudiante: `${student.first_name} ${student.last_name}`, clase: session.course_name, fecha: session.date, entrada: 'manual' }).run();

    if (pay) {
      const ch = await db.prepare('SELECT id, due_cents FROM charge_status WHERE attendance_id = ?').bind(att.id).first();
      if (ch && ch.due_cents === 0) {
        const { due_cents } = await balance(db, studentId);
        if (!due_cents) throw new HttpError(409, 'Esta clase ya está pagada');
      }
      await createPayment(ctx, { studentId, amount: pay.amount, method: pay.method, clientRef: pay.clientRef, priority: ch ? [ch.id] : [] });
    }

    if (wantBand) {
      await db.prepare(
        `INSERT INTO wristbands (attendance_id, delivered, code, delivered_by, delivered_at) VALUES (?,1,?,?,?)
         ON CONFLICT(attendance_id) DO UPDATE SET delivered = 1, delivered_by = excluded.delivered_by, delivered_at = excluded.delivered_at
         WHERE delivered = 0`
      ).bind(att.id, bandOfDay(session.date), ctx.user.id, nowIso()).run();
    }
    const st = await db.prepare(`${STUDENT_ROW_SQL} WHERE s.id = ?2`).bind(session.id, studentId).first();
    return json({ ok: true, attendance_id: att.id, student: st });
  });

  // Corrección (solo admin): anular la asistencia. El cargo de la clase se borra; si había pago, queda como saldo a favor.
  r.delete('/api/checkin/:attendanceId', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params, 'attendanceId');
    const db = ctx.env.DB;
    const att = await db.prepare(
      `SELECT a.id, s.first_name || ' ' || s.last_name AS student FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`
    ).bind(id).first();
    if (!att) throw notFound('Asistencia no encontrada');
    await db.batch([
      db.prepare('DELETE FROM payment_allocations WHERE charge_id IN (SELECT id FROM charges WHERE attendance_id = ?)').bind(id),
      db.prepare('DELETE FROM charges WHERE attendance_id = ?').bind(id),
      db.prepare('DELETE FROM wristbands WHERE attendance_id = ?').bind(id),
      db.prepare('DELETE FROM attendance WHERE id = ?').bind(id),
      auditStmt(ctx, 'anular_asistencia', 'attendance', id, att),
    ]);
    return json({ ok: true });
  });
}

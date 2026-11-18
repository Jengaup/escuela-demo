import { json, badRequest } from '../http.js';
import { isIsoDate } from '../validate.js';
import { requireAdmin } from '../auth.js';
import { todayPR, addDays } from '../time.js';
import { COURSE_LABEL_SQL } from './checkin.js';

const JOINS = `JOIN class_sessions cs ON cs.id = a.session_id JOIN courses c ON c.id = cs.course_id
  JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id JOIN students s ON s.id = a.student_id`;

function dateParam(url, key, fallback) {
  const v = url.searchParams.get(key) || fallback;
  if (!isIsoDate(v)) throw badRequest(`Fecha inválida: ${key}`);
  return v;
}

export function register(r) {
  // Cuadre de caja de un día: por método, por staff y detalle.
  r.get('/api/reports/cash', async (ctx) => {
    const date = dateParam(ctx.url, 'date', todayPR());
    const db = ctx.env.DB;
    const [detail, pending] = await db.batch([
      db.prepare(
        `SELECT pm.id, pm.created_at, pm.amount_cents, pm.method, u.id AS user_id, u.name AS received_by,
                s.first_name || ' ' || s.last_name AS student, ${COURSE_LABEL_SQL} AS course_name, cs.date AS class_date
           FROM payments pm JOIN attendance a ON a.id = pm.attendance_id ${JOINS} JOIN users u ON u.id = pm.received_by
          WHERE pm.local_date = ? ORDER BY pm.created_at`
      ).bind(date),
      db.prepare(
        `SELECT a.id, s.first_name || ' ' || s.last_name AS student, ${COURSE_LABEL_SQL} AS course_name, c.price_cents
           FROM attendance a ${JOINS} LEFT JOIN payments pm ON pm.attendance_id = a.id
          WHERE cs.date = ? AND pm.id IS NULL ORDER BY course_name, student`
      ).bind(date),
    ]);
    const methods = { efectivo: 0, ath_movil: 0, tarjeta: 0 };
    const counts = { efectivo: 0, ath_movil: 0, tarjeta: 0 };
    const staff = {};
    for (const p of detail.results) {
      methods[p.method] += p.amount_cents;
      counts[p.method]++;
      staff[p.user_id] ||= { name: p.received_by, efectivo: 0, ath_movil: 0, tarjeta: 0, total: 0, n: 0 };
      staff[p.user_id][p.method] += p.amount_cents;
      staff[p.user_id].total += p.amount_cents;
      staff[p.user_id].n++;
    }
    return json({
      date,
      methods,
      counts,
      total: Object.values(methods).reduce((a, b) => a + b, 0),
      staff: Object.values(staff).sort((a, b) => b.total - a.total),
      payments: detail.results,
      pending: pending.results,
    });
  });

  // Reporte por rango de fechas (asistencia + pagos), opcionalmente por curso.
  r.get('/api/reports/range', async (ctx) => {
    const today = todayPR();
    const from = dateParam(ctx.url, 'from', addDays(today, -13));
    const to = dateParam(ctx.url, 'to', today);
    if (from > to) throw badRequest('La fecha inicial debe ser antes de la final');
    if (addDays(from, 366) < to) throw badRequest('El rango máximo es de un año');
    const courseId = Number(ctx.url.searchParams.get('course_id')) || null;
    const db = ctx.env.DB;
    const courseFilter = courseId ? 'AND c.id = ?3' : '';
    const binds = courseId ? [from, to, courseId] : [from, to];

    const [attendance, payments, summary] = await db.batch([
      db.prepare(
        `SELECT cs.date, ${COURSE_LABEL_SQL} AS course_name, s.id AS student_id, s.first_name || ' ' || s.last_name AS student,
                a.signed_by, a.signed_at, pm.amount_cents, pm.method, u.name AS received_by, w.delivered AS band, w.code AS band_code
           FROM attendance a ${JOINS}
           LEFT JOIN payments pm ON pm.attendance_id = a.id LEFT JOIN users u ON u.id = pm.received_by
           LEFT JOIN wristbands w ON w.attendance_id = a.id
          WHERE cs.date BETWEEN ?1 AND ?2 ${courseFilter}
          ORDER BY cs.date DESC, c.start_time, student LIMIT 5000`
      ).bind(...binds),
      db.prepare(
        `SELECT pm.local_date, pm.created_at, pm.amount_cents, pm.method, u.name AS received_by,
                s.first_name || ' ' || s.last_name AS student, ${COURSE_LABEL_SQL} AS course_name, cs.date AS class_date
           FROM payments pm JOIN attendance a ON a.id = pm.attendance_id ${JOINS} JOIN users u ON u.id = pm.received_by
          WHERE pm.local_date BETWEEN ?1 AND ?2 ${courseFilter}
          ORDER BY pm.created_at DESC LIMIT 5000`
      ).bind(...binds),
      db.prepare(
        `SELECT c.id, ${COURSE_LABEL_SQL} AS course_name,
                COUNT(DISTINCT cs.id) AS sessions,
                COUNT(a.id) AS attendances,
                COUNT(pm.id) AS paid_count,
                IFNULL(SUM(pm.amount_cents), 0) AS collected,
                IFNULL(SUM(CASE WHEN pm.method = 'efectivo' THEN pm.amount_cents END), 0) AS efectivo,
                IFNULL(SUM(CASE WHEN pm.method = 'ath_movil' THEN pm.amount_cents END), 0) AS ath_movil,
                IFNULL(SUM(CASE WHEN pm.method = 'tarjeta' THEN pm.amount_cents END), 0) AS tarjeta
           FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
           JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
           LEFT JOIN attendance a ON a.session_id = cs.id LEFT JOIN payments pm ON pm.attendance_id = a.id
          WHERE cs.date BETWEEN ?1 AND ?2 ${courseFilter}
          GROUP BY c.id ORDER BY course_name`
      ).bind(...binds),
    ]);
    return json({ from, to, course_id: courseId, attendance: attendance.results, payments: payments.results, summary: summary.results });
  });

  // Bitácora de auditoría (solo admin).
  r.get('/api/audit', async (ctx) => {
    requireAdmin(ctx);
    const limit = Math.min(500, Math.max(1, Number(ctx.url.searchParams.get('limit')) || 200));
    const { results } = await ctx.env.DB.prepare(
      'SELECT id, username, action, entity, entity_id, details, ip, created_at FROM audit_log ORDER BY id DESC LIMIT ?'
    ).bind(limit).all();
    return json({ entries: results });
  });
}

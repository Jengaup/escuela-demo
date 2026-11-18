import { json, badRequest } from '../http.js';
import { isIsoDate } from '../validate.js';
import { requireAdmin } from '../auth.js';
import { todayPR, addDays } from '../time.js';
import { COURSE_LABEL_SQL } from './checkin.js';
import { DUE_SQL, CREDIT_SQL } from '../ledger.js';

const JOINS = `JOIN class_sessions cs ON cs.id = a.session_id JOIN courses c ON c.id = cs.course_id
  JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id JOIN students s ON s.id = a.student_id`;

// En qué se aplicó cada pago (clase, examen, matrícula…) y si quedó saldo a favor.
const PAYMENT_CONCEPT_SQL = `
  TRIM(IFNULL((SELECT group_concat(c2.description, ' + ') FROM payment_allocations pa JOIN charges c2 ON c2.id = pa.charge_id WHERE pa.payment_id = ps.id), '')
       || CASE WHEN ps.free_cents > 0 THEN ' (saldo a favor)' ELSE '' END)`;

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
        `SELECT ps.id, ps.created_at, ps.amount_cents, ps.method, u.id AS user_id, u.name AS received_by,
                s.first_name || ' ' || s.last_name AS student, ${PAYMENT_CONCEPT_SQL} AS concept
           FROM payment_status ps JOIN students s ON s.id = ps.student_id JOIN users u ON u.id = ps.received_by
          WHERE ps.local_date = ? ORDER BY ps.created_at`
      ).bind(date),
      // Asistieron ese día y la clase quedó pendiente ("paga después")
      db.prepare(
        `SELECT a.id, s.first_name || ' ' || s.last_name AS student, ${COURSE_LABEL_SQL} AS course_name, ch.due_cents
           FROM attendance a ${JOINS} JOIN charge_status ch ON ch.attendance_id = a.id
          WHERE cs.date = ? AND ch.due_cents > 0 ORDER BY course_name, student`
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

  // Reporte por rango de fechas, opcionalmente por curso.
  r.get('/api/reports/range', async (ctx) => {
    const today = todayPR();
    const from = dateParam(ctx.url, 'from', addDays(today, -13));
    const to = dateParam(ctx.url, 'to', today);
    if (from > to) throw badRequest('La fecha inicial debe ser antes de la final');
    if (addDays(from, 366) < to) throw badRequest('El rango máximo es de un año');
    const courseId = Number(ctx.url.searchParams.get('course_id')) || null;
    const db = ctx.env.DB;
    const binds = courseId ? [from, to, courseId] : [from, to];

    const [attendance, payments, summary] = await db.batch([
      db.prepare(
        `SELECT cs.date, ${COURSE_LABEL_SQL} AS course_name, s.id AS student_id, s.first_name || ' ' || s.last_name AS student,
                a.check_in_method, a.created_at, ch.amount_cents, ch.due_cents, w.delivered AS band, w.code AS band_code
           FROM attendance a ${JOINS}
           LEFT JOIN charge_status ch ON ch.attendance_id = a.id
           LEFT JOIN wristbands w ON w.attendance_id = a.id
          WHERE cs.date BETWEEN ?1 AND ?2 ${courseId ? 'AND c.id = ?3' : ''}
          ORDER BY cs.date DESC, c.start_time, student LIMIT 5000`
      ).bind(...binds),
      // Pagos: con filtro de curso, solo los que se aplicaron a cargos de ese curso
      db.prepare(
        `SELECT ps.local_date, ps.created_at, ps.amount_cents, ps.method, u.name AS received_by,
                s.first_name || ' ' || s.last_name AS student, ${PAYMENT_CONCEPT_SQL} AS concept
           FROM payment_status ps JOIN students s ON s.id = ps.student_id JOIN users u ON u.id = ps.received_by
          WHERE ps.local_date BETWEEN ?1 AND ?2
            ${courseId ? 'AND EXISTS (SELECT 1 FROM payment_allocations pa JOIN charges c3 ON c3.id = pa.charge_id WHERE pa.payment_id = ps.id AND c3.course_id = ?3)' : ''}
          ORDER BY ps.created_at DESC LIMIT 5000`
      ).bind(...binds),
      // Por curso: clases dadas, asistencias, lo facturado (clases + examen + matrícula), cobrado y pendiente
      db.prepare(
        `SELECT c.id, ${COURSE_LABEL_SQL} AS course_name,
                (SELECT COUNT(*) FROM class_sessions x WHERE x.course_id = c.id AND x.date BETWEEN ?1 AND ?2
                   AND EXISTS (SELECT 1 FROM attendance ax WHERE ax.session_id = x.id)) AS sessions,
                (SELECT COUNT(*) FROM attendance ax JOIN class_sessions x ON x.id = ax.session_id WHERE x.course_id = c.id AND x.date BETWEEN ?1 AND ?2) AS attendances,
                IFNULL(SUM(CASE WHEN ch.kind = 'clase' THEN ch.amount_cents END), 0) AS classes_cents,
                IFNULL(SUM(CASE WHEN ch.kind <> 'clase' THEN ch.amount_cents END), 0) AS other_cents,
                IFNULL(SUM(ch.amount_cents), 0) AS billed_cents,
                IFNULL(SUM(ch.amount_cents - ch.due_cents), 0) AS collected_cents,
                IFNULL(SUM(ch.due_cents), 0) AS due_cents
           FROM courses c JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
           LEFT JOIN charge_status ch ON ch.course_id = c.id AND ch.local_date BETWEEN ?1 AND ?2
          WHERE 1 = 1 ${courseId ? 'AND c.id = ?3' : ''}
          GROUP BY c.id HAVING attendances > 0 OR billed_cents > 0 ORDER BY course_name`
      ).bind(...binds),
    ]);
    return json({ from, to, course_id: courseId, attendance: attendance.results, payments: payments.results, summary: summary.results });
  });

  // Quién debe (cuentas por cobrar) y quién tiene saldo a favor.
  r.get('/api/reports/debts', async (ctx) => {
    const { results } = await ctx.env.DB.prepare(
      `SELECT * FROM (
         SELECT s.id, s.first_name || ' ' || s.last_name AS student, s.guardian_name, s.phone,
                ${DUE_SQL} AS due_cents, ${CREDIT_SQL} AS credit_cents,
                (SELECT MIN(cs2.local_date) FROM charge_status cs2 WHERE cs2.student_id = s.id AND cs2.due_cents > 0) AS oldest,
                (SELECT group_concat(cs2.description, ' + ') FROM charge_status cs2 WHERE cs2.student_id = s.id AND cs2.due_cents > 0) AS items
           FROM students s)
        WHERE due_cents > 0 OR credit_cents > 0
        ORDER BY due_cents DESC, credit_cents DESC`
    ).all();
    return json({ students: results });
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

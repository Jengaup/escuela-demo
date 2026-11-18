import { json } from '../http.js';
import { todayPR, addDays, bandOfDay } from '../time.js';
import { ensureSessions, COURSE_LABEL_SQL } from './checkin.js';

export function register(r) {
  r.get('/api/dashboard', async (ctx) => {
    const db = ctx.env.DB;
    const today = todayPR();
    await ensureSessions(ctx.env, today);
    const weekStart = addDays(today, -6);
    const [sessions, byMethod, week, recent, counts] = await db.batch([
      db.prepare(
        `SELECT cs.id, ${COURSE_LABEL_SQL} AS course_name, c.start_time, c.end_time, c.instructor,
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'activo') AS enrolled,
                (SELECT COUNT(*) FROM attendance a WHERE a.session_id = cs.id) AS attended,
                (SELECT IFNULL(SUM(pm.amount_cents),0) FROM attendance a JOIN payments pm ON pm.attendance_id = a.id WHERE a.session_id = cs.id) AS collected
           FROM class_sessions cs JOIN courses c ON c.id = cs.course_id
           JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
          WHERE cs.date = ? ORDER BY c.start_time`
      ).bind(today),
      db.prepare(`SELECT method, COUNT(*) AS n, SUM(amount_cents) AS total FROM payments WHERE local_date = ? GROUP BY method`).bind(today),
      db.prepare(
        `SELECT local_date AS date, SUM(amount_cents) AS total, COUNT(*) AS n FROM payments
          WHERE local_date BETWEEN ? AND ? GROUP BY local_date ORDER BY local_date`
      ).bind(weekStart, today),
      db.prepare(
        `SELECT a.id, s.first_name || ' ' || s.last_name AS student, ${COURSE_LABEL_SQL} AS course_name, a.created_at,
                pm.method, pm.amount_cents
           FROM attendance a JOIN students s ON s.id = a.student_id JOIN class_sessions cs ON cs.id = a.session_id
           JOIN courses c ON c.id = cs.course_id JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
           LEFT JOIN payments pm ON pm.attendance_id = a.id
          WHERE cs.date = ? ORDER BY a.created_at DESC LIMIT 8`
      ).bind(today),
      db.prepare(
        `SELECT (SELECT COUNT(*) FROM students WHERE active = 1) AS students,
                (SELECT COUNT(*) FROM courses WHERE active = 1) AS courses`
      ),
    ]);
    const methods = { efectivo: 0, ath_movil: 0, tarjeta: 0 };
    for (const m of byMethod.results) methods[m.method] = m.total;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const f = week.results.find((w) => w.date === d);
      days.push({ date: d, total: f?.total || 0, n: f?.n || 0 });
    }
    return json({
      today,
      band: bandOfDay(today),
      sessions: sessions.results,
      attended: sessions.results.reduce((t, s) => t + s.attended, 0),
      enrolled: sessions.results.reduce((t, s) => t + s.enrolled, 0),
      methods,
      total: Object.values(methods).reduce((a, b) => a + b, 0),
      week: days,
      recent: recent.results,
      counts: counts.results[0],
      demo: ctx.env.DEMO_MODE === 'true',
    });
  });
}

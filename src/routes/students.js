import { json, readJson, badRequest, notFound, HttpError } from '../http.js';
import { V, idParam } from '../validate.js';
import { auditStmt } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { todayPR } from '../time.js';
import { COURSE_LABEL_SQL } from './checkin.js';

export function validateStudent(src) {
  const v = new V(src);
  const s = {
    first_name: v.str('first_name', { required: true, max: 60, label: 'Nombre' }),
    last_name: v.str('last_name', { required: true, max: 80, label: 'Apellidos' }),
    birth_date: v.date('birth_date', { label: 'Fecha de nacimiento' }),
    guardian_name: v.str('guardian_name', { max: 100, label: 'Encargado' }),
    phone: v.phone('phone'),
    email: v.email('email'),
    notes: v.text('notes', { max: 1000, label: 'Notas' }),
  };
  if (s.birth_date && (s.birth_date > todayPR() || s.birth_date < '1920-01-01')) v.fail('birth_date', 'Fecha de nacimiento fuera de rango');
  return { v, s };
}

function validateGuardians(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > 5) throw badRequest('Lista de encargados inválida');
  return list.map((g, i) => {
    const v = new V(g);
    const out = {
      name: v.str('name', { required: true, max: 100, label: `Nombre del encargado ${i + 1}` }),
      relationship: v.str('relationship', { max: 40, label: 'Relación' }),
      phone: v.phone('phone', { label: `Teléfono del encargado ${i + 1}` }),
      email: v.email('email', { label: `Email del encargado ${i + 1}` }),
    };
    v.done();
    return out;
  });
}

const insertStudentSql = `INSERT INTO students (first_name, last_name, birth_date, guardian_name, phone, email, notes)
  VALUES (?,?,?,?,?,?,?) RETURNING id`;
export const studentParams = (s) => [s.first_name, s.last_name, s.birth_date, s.guardian_name, s.phone, s.email, s.notes];

export function register(r) {
  r.get('/api/students', async (ctx) => {
    const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 80);
    const status = ctx.url.searchParams.get('status') || 'activo';
    const courseId = Number(ctx.url.searchParams.get('course_id')) || null;
    const where = [];
    const params = [];
    if (status === 'activo') where.push('s.active = 1');
    else if (status === 'inactivo') where.push('s.active = 0');
    if (q) {
      where.push(`(s.first_name || ' ' || s.last_name LIKE ? OR s.phone LIKE ? OR s.email LIKE ? OR s.guardian_name LIKE ?)`);
      const like = `%${q.replace(/[%_]/g, '')}%`;
      params.push(like, like, like, like);
    }
    if (courseId) {
      where.push(`s.id IN (SELECT student_id FROM enrollments WHERE course_id = ? AND status = 'activo')`);
      params.push(courseId);
    }
    const { results } = await ctx.env.DB.prepare(
      `SELECT s.id, s.first_name, s.last_name, s.birth_date, s.guardian_name, s.phone, s.email, s.active,
              (SELECT group_concat(${COURSE_LABEL_SQL}, ', ') FROM enrollments e JOIN courses c ON c.id = e.course_id
                 JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
                WHERE e.student_id = s.id AND e.status = 'activo') AS courses,
              (SELECT MAX(cs.date) FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id WHERE a.student_id = s.id) AS last_visit
         FROM students s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY s.first_name, s.last_name LIMIT 500`
    ).bind(...params).all();
    return json({ students: results });
  });

  r.get('/api/students/:id', async (ctx) => {
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const student = await db.prepare('SELECT * FROM students WHERE id = ?').bind(id).first();
    if (!student) throw notFound('Estudiante no encontrado');
    const [guardians, enrollments, history] = await db.batch([
      db.prepare('SELECT id, name, relationship, phone, email FROM guardians WHERE student_id = ? ORDER BY id').bind(id),
      db.prepare(
        `SELECT e.id, e.course_id, e.enrolled_on, e.status, ${COURSE_LABEL_SQL} AS course_name, c.days, c.start_time, c.price_cents
           FROM enrollments e JOIN courses c ON c.id = e.course_id
           JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
          WHERE e.student_id = ? ORDER BY e.status, course_name`
      ).bind(id),
      db.prepare(
        `SELECT a.id AS attendance_id, cs.date, ${COURSE_LABEL_SQL} AS course_name, a.signed_by, a.signed_at,
                pm.amount_cents, pm.method, u.name AS received_by, w.delivered AS band_delivered, w.code AS band_code
           FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
           JOIN courses c ON c.id = cs.course_id JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id
           LEFT JOIN payments pm ON pm.attendance_id = a.id LEFT JOIN users u ON u.id = pm.received_by
           LEFT JOIN wristbands w ON w.attendance_id = a.id
          WHERE a.student_id = ? ORDER BY cs.date DESC, c.start_time DESC LIMIT 200`
      ).bind(id),
    ]);
    const paid = history.results.reduce((t, h) => t + (h.amount_cents || 0), 0);
    return json({
      student,
      guardians: guardians.results,
      enrollments: enrollments.results,
      history: history.results,
      totals: { classes: history.results.length, paid_cents: paid, unpaid: history.results.filter((h) => !h.method).length },
    });
  });

  r.post('/api/students', async (ctx) => {
    const body = await readJson(ctx.request);
    const { v, s } = validateStudent(body);
    v.done();
    const guardians = validateGuardians(body.guardians) || [];
    const courseIds = Array.isArray(body.course_ids) ? body.course_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10) : [];

    const db = ctx.env.DB;
    const dup = await db.prepare(
      `SELECT id FROM students WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND IFNULL(birth_date,'') = IFNULL(?, '')`
    ).bind(s.first_name, s.last_name, s.birth_date).first();
    if (dup && !body.allow_duplicate) throw new HttpError(409, 'Ya existe un estudiante con ese nombre y fecha de nacimiento');

    const row = await db.prepare(insertStudentSql).bind(...studentParams(s)).first();
    const stmts = guardians.map((g) => db.prepare('INSERT INTO guardians (student_id, name, relationship, phone, email) VALUES (?,?,?,?,?)').bind(row.id, g.name, g.relationship, g.phone, g.email));
    for (const cid of courseIds) {
      stmts.push(db.prepare(`INSERT INTO enrollments (student_id, course_id, enrolled_on) SELECT ?, id, ? FROM courses WHERE id = ? ON CONFLICT DO NOTHING`).bind(row.id, todayPR(), cid));
    }
    stmts.push(auditStmt(ctx, 'crear_estudiante', 'student', row.id, { nombre: `${s.first_name} ${s.last_name}`, cursos: courseIds }));
    await db.batch(stmts);
    return json({ id: row.id }, 201);
  });

  r.put('/api/students/:id', async (ctx) => {
    const id = idParam(ctx.params);
    const body = await readJson(ctx.request);
    const { v, s } = validateStudent(body);
    const active = body.active === undefined ? 1 : v.bool('active') ? 1 : 0;
    v.done();
    const guardians = validateGuardians(body.guardians);
    const db = ctx.env.DB;
    const exists = await db.prepare('SELECT id FROM students WHERE id = ?').bind(id).first();
    if (!exists) throw notFound('Estudiante no encontrado');

    const stmts = [
      db.prepare(
        `UPDATE students SET first_name=?, last_name=?, birth_date=?, guardian_name=?, phone=?, email=?, notes=?, active=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(...studentParams(s), active, id),
    ];
    if (guardians) {
      stmts.push(db.prepare('DELETE FROM guardians WHERE student_id = ?').bind(id));
      for (const g of guardians) stmts.push(db.prepare('INSERT INTO guardians (student_id, name, relationship, phone, email) VALUES (?,?,?,?,?)').bind(id, g.name, g.relationship, g.phone, g.email));
    }
    // Al desactivar, sus matrículas pasan a inactivas.
    if (!active) stmts.push(db.prepare(`UPDATE enrollments SET status = 'inactivo' WHERE student_id = ?`).bind(id));
    stmts.push(auditStmt(ctx, 'editar_estudiante', 'student', id, { ...s, active }));
    await db.batch(stmts);
    return json({ ok: true });
  });

  r.delete('/api/students/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const st = await db.prepare(
      `SELECT first_name || ' ' || last_name AS name, (SELECT COUNT(*) FROM attendance WHERE student_id = ?1) AS n FROM students WHERE id = ?1`
    ).bind(id).first();
    if (!st) throw notFound('Estudiante no encontrado');
    if (st.n > 0) throw new HttpError(409, 'Tiene asistencias y pagos registrados. Desactívalo en lugar de borrarlo.');
    await db.batch([
      db.prepare('DELETE FROM students WHERE id = ?').bind(id),
      auditStmt(ctx, 'borrar_estudiante', 'student', id, { nombre: st.name }),
    ]);
    return json({ ok: true });
  });
}

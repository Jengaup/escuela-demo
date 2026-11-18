import { json, readJson, notFound, HttpError } from '../http.js';
import { V, idParam } from '../validate.js';
import { auditStmt } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { todayPR } from '../time.js';
import { COURSE_LABEL_SQL } from './checkin.js';
import { enrollmentCharge } from '../ledger.js';

function validateCourse(src) {
  const v = new V(src);
  const c = {
    program_id: v.int('program_id', { required: true, min: 1, label: 'Programa' }),
    level_id: v.int('level_id', { required: true, min: 1, label: 'Nivel' }),
    start_time: v.time('start_time', { required: true, label: 'Hora de inicio' }),
    end_time: v.time('end_time', { required: true, label: 'Hora de fin' }),
    price_cents: v.money('price', { required: true, max: 2000, label: 'Precio por clase' }),
    exam_fee_cents: v.money('exam_fee', { max: 2000, label: 'Costo de examen' }) ?? 0,
    enrollment_fee_cents: v.money('enrollment_fee', { max: 2000, label: 'Costo de matrícula' }) ?? 0,
    instructor: v.str('instructor', { required: true, max: 100, label: 'Instructor' }),
    active: src.active === undefined ? 1 : v.bool('active') ? 1 : 0,
  };
  const days = Array.isArray(src.days) ? [...new Set(src.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  if (!days.length) v.fail('days', 'Selecciona al menos un día');
  c.days = days.join(',');
  if (c.start_time && c.end_time && c.end_time <= c.start_time) v.fail('end_time', 'La hora de fin debe ser después del inicio');
  v.done();
  return c;
}

const COURSE_SELECT = `
  SELECT c.*, ${COURSE_LABEL_SQL} AS name, p.name AS program, l.name AS level,
         (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'activo') AS enrolled
    FROM courses c JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id`;

export function register(r) {
  r.get('/api/catalog', async (ctx) => {
    const [programs, levels] = await ctx.env.DB.batch([
      ctx.env.DB.prepare('SELECT id, name FROM programs ORDER BY id'),
      ctx.env.DB.prepare('SELECT id, name FROM levels ORDER BY sort_order'),
    ]);
    return json({ programs: programs.results, levels: levels.results });
  });

  r.get('/api/courses', async (ctx) => {
    const all = ctx.url.searchParams.get('all') === '1';
    const { results } = await ctx.env.DB.prepare(
      `${COURSE_SELECT} ${all ? '' : 'WHERE c.active = 1'} ORDER BY c.active DESC, c.program_id, l.sort_order, c.start_time`
    ).all();
    return json({ courses: results });
  });

  r.post('/api/courses', async (ctx) => {
    requireAdmin(ctx);
    const c = validateCourse(await readJson(ctx.request));
    const row = await ctx.env.DB.prepare(
      `INSERT INTO courses (program_id, level_id, days, start_time, end_time, price_cents, exam_fee_cents, enrollment_fee_cents, instructor, active)
       VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`
    ).bind(c.program_id, c.level_id, c.days, c.start_time, c.end_time, c.price_cents, c.exam_fee_cents, c.enrollment_fee_cents, c.instructor, c.active).first();
    await auditStmt(ctx, 'crear_curso', 'course', row.id, c).run();
    return json({ id: row.id }, 201);
  });

  r.put('/api/courses/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const c = validateCourse(await readJson(ctx.request));
    const res = await ctx.env.DB.prepare(
      `UPDATE courses SET program_id=?, level_id=?, days=?, start_time=?, end_time=?, price_cents=?, exam_fee_cents=?, enrollment_fee_cents=?,
              instructor=?, active=? WHERE id = ?`
    ).bind(c.program_id, c.level_id, c.days, c.start_time, c.end_time, c.price_cents, c.exam_fee_cents, c.enrollment_fee_cents, c.instructor, c.active, id).run();
    if (!res.meta.changes) throw notFound('Curso no encontrado');
    await auditStmt(ctx, 'editar_curso', 'course', id, c).run();
    return json({ ok: true });
  });

  r.delete('/api/courses/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = idParam(ctx.params);
    const db = ctx.env.DB;
    const n = await db.prepare('SELECT COUNT(*) AS n FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id WHERE cs.course_id = ?').bind(id).first();
    if (n.n > 0) throw new HttpError(409, 'El curso tiene asistencias registradas. Desactívalo en lugar de borrarlo.');
    const res = await db.batch([
      db.prepare('DELETE FROM courses WHERE id = ?').bind(id),
      auditStmt(ctx, 'borrar_curso', 'course', id),
    ]);
    if (!res[0].meta.changes) throw notFound('Curso no encontrado');
    return json({ ok: true });
  });

  // ----- Matrículas -----
  r.get('/api/courses/:id/enrollments', async (ctx) => {
    const id = idParam(ctx.params);
    const { results } = await ctx.env.DB.prepare(
      `SELECT e.id, e.student_id, e.enrolled_on, e.status, s.first_name, s.last_name, s.phone, s.guardian_name
         FROM enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.course_id = ? ORDER BY e.status, s.first_name, s.last_name`
    ).bind(id).all();
    return json({ enrollments: results });
  });

  r.post('/api/enrollments', async (ctx) => {
    const v = new V(await readJson(ctx.request));
    const studentId = v.int('student_id', { required: true, min: 1, label: 'Estudiante' });
    const courseId = v.int('course_id', { required: true, min: 1, label: 'Curso' });
    const date = v.date('enrolled_on', { label: 'Fecha' }) || todayPR();
    v.done();
    const db = ctx.env.DB;
    const ok = await db.prepare('SELECT (SELECT active FROM students WHERE id = ?) AS s, (SELECT active FROM courses WHERE id = ?) AS c').bind(studentId, courseId).first();
    if (ok.s === null || ok.c === null) throw notFound('Estudiante o curso no existe');
    if (!ok.s) throw new HttpError(409, 'El estudiante está inactivo');
    const existed = await db.prepare('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?').bind(studentId, courseId).first();
    const row = await db.prepare(
      `INSERT INTO enrollments (student_id, course_id, enrolled_on) VALUES (?,?,?)
       ON CONFLICT(student_id, course_id) DO UPDATE SET status = 'activo' RETURNING id`
    ).bind(studentId, courseId, date).first();
    await auditStmt(ctx, 'matricular', 'enrollment', row.id, { student_id: studentId, course_id: courseId }).run();
    // La matrícula se cobra solo la primera vez (reactivar no vuelve a cobrar).
    const chargeId = existed ? null : await enrollmentCharge(ctx, studentId, courseId);
    return json({ id: row.id, enrollment_charge_id: chargeId }, 201);
  });

  r.put('/api/enrollments/:id', async (ctx) => {
    const id = idParam(ctx.params);
    const v = new V(await readJson(ctx.request));
    const status = v.oneOf('status', ['activo', 'inactivo'], { required: true, label: 'Estado' });
    v.done();
    const res = await ctx.env.DB.prepare('UPDATE enrollments SET status = ? WHERE id = ?').bind(status, id).run();
    if (!res.meta.changes) throw notFound('Matrícula no encontrada');
    await auditStmt(ctx, 'estado_matricula', 'enrollment', id, { status }).run();
    return json({ ok: true });
  });
}

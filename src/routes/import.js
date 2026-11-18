import { json, readJson, badRequest } from '../http.js';
import { auditStmt } from '../audit.js';
import { todayPR } from '../time.js';
import { validateStudent, studentParams } from './students.js';

const MAX_ROWS = 1000;      // validación (dry run)
export const MAX_IMPORT = 40; // por solicitud al guardar; el navegador manda el archivo en grupos

// INSERT de varias filas por consulta (D1 permite hasta 100 parámetros), para gastar pocas consultas.
function multiInsert(db, sql, cols, rows, suffix = '') {
  const per = Math.floor(99 / cols);
  const out = [];
  for (let i = 0; i < rows.length; i += per) {
    const part = rows.slice(i, i + per);
    out.push(db.prepare(`${sql} VALUES ${part.map(() => `(${Array(cols).fill('?').join(',')})`).join(',')} ${suffix}`).bind(...part.flat()));
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Convierte fechas comunes de Excel/CSV a AAAA-MM-DD: 2012-05-04, 5/4/2012 (M/D/AAAA), 04-05-2012, serial de Excel.
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 1000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
    // En PR se usa M/D/AAAA; si el primer número es > 12, se asume D/M/AAAA.
    const [mo, d] = Number(a) > 12 ? [b, a] : [a, b];
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s; // el validador lo rechazará con un mensaje claro
}

export function register(r) {
  r.post('/api/students/import', async (ctx) => {
    const body = await readJson(ctx.request);
    if (!Array.isArray(body.rows) || !body.rows.length) throw badRequest('No hay filas para importar');
    const dryRun = !!body.dry_run;
    if (body.rows.length > MAX_ROWS) throw badRequest(`Máximo ${MAX_ROWS} filas por importación`);
    if (!dryRun && body.rows.length > MAX_IMPORT) throw badRequest(`Máximo ${MAX_IMPORT} filas por envío`);
    const courseId = Number(body.course_id) || null;
    const db = ctx.env.DB;

    let course = null;
    if (courseId) {
      course = await db.prepare(`SELECT c.id, c.enrollment_fee_cents AS fee, p.name || ' ' || l.name AS name FROM courses c
        JOIN programs p ON p.id = c.program_id JOIN levels l ON l.id = c.level_id WHERE c.id = ?`).bind(courseId).first();
      if (!course) throw badRequest('Curso inválido');
    }

    const { results: existing } = await db.prepare('SELECT first_name, last_name, birth_date FROM students').all();
    const seen = new Set(existing.map((s) => `${norm(s.first_name)}|${norm(s.last_name)}|${s.birth_date || ''}`));

    const valid = [];
    const report = [];
    body.rows.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return report.push({ row: i + 1, status: 'error', error: 'Fila inválida' });
      let first = raw.first_name, last = raw.last_name;
      // Si solo viene "nombre completo", se separa: primera palabra = nombre, resto = apellidos.
      if (raw.full_name && !first && !last) {
        const parts = String(raw.full_name).trim().split(/\s+/);
        first = parts.shift();
        last = parts.join(' ');
      }
      const src = { ...raw, first_name: first, last_name: last, birth_date: parseDate(raw.birth_date) };
      const { v, s } = validateStudent(src);
      const errs = Object.values(v.errors);
      if (errs.length) return report.push({ row: i + 1, status: 'error', error: errs.join('; ') });
      const key = `${norm(s.first_name)}|${norm(s.last_name)}|${s.birth_date || ''}`;
      if (seen.has(key)) return report.push({ row: i + 1, status: 'duplicado', error: 'Ya existe (mismo nombre y fecha de nacimiento)' });
      seen.add(key);
      valid.push({ row: i + 1, s });
      report.push({ row: i + 1, status: 'ok' });
    });

    const summary = {
      ok: report.filter((x) => x.status === 'ok').length,
      duplicados: report.filter((x) => x.status === 'duplicado').length,
      errores: report.filter((x) => x.status === 'error').length,
    };
    if (dryRun || !valid.length) return json({ dry_run: dryRun, summary, report, created: 0 });

    const date = todayPR();
    const ins = await db.batch(multiInsert(db, 'INSERT INTO students (first_name, last_name, birth_date, guardian_name, phone, email, notes)', 7,
      valid.map(({ s }) => studentParams(s)), 'RETURNING id, first_name, last_name, birth_date'));
    const idOf = new Map(ins.flatMap((r) => r.results).map((x) => [`${x.first_name}|${x.last_name}|${x.birth_date || ''}`, x.id]));
    const ids = valid.map(({ s }) => idOf.get(`${s.first_name}|${s.last_name}|${s.birth_date || ''}`));
    const extra = [
      ...multiInsert(db, 'INSERT INTO guardians (student_id, name, phone)', 3,
        valid.map(({ s }, k) => [ids[k], s.guardian_name, s.phone]).filter((g) => g[1])),
    ];
    if (course) {
      extra.push(...multiInsert(db, 'INSERT OR IGNORE INTO enrollments (student_id, course_id, enrolled_on)', 3, ids.map((id) => [id, course.id, date])));
      // Estudiantes nuevos: la matrícula queda como deuda (no tienen saldo a favor que aplicar).
      if (course.fee) {
        extra.push(...multiInsert(db, 'INSERT INTO charges (student_id, kind, description, amount_cents, course_id, local_date, created_by)', 7,
          ids.map((id) => [id, 'matricula', `Matrícula · ${course.name}`, course.fee, course.id, date, ctx.user.id])));
      }
    }
    if (extra.length) await db.batch(extra);
    const created = ids.length;
    await auditStmt(ctx, 'importar_estudiantes', 'student', null, { creados: created, ...summary, curso: courseId }).run();
    return json({ dry_run: false, summary, report, created });
  });
}

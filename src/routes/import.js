import { json, readJson, badRequest } from '../http.js';
import { auditStmt } from '../audit.js';
import { todayPR } from '../time.js';
import { validateStudent, studentParams } from './students.js';

const MAX_ROWS = 1000;

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
    if (body.rows.length > MAX_ROWS) throw badRequest(`Máximo ${MAX_ROWS} filas por importación`);
    const dryRun = !!body.dry_run;
    const courseId = Number(body.course_id) || null;
    const db = ctx.env.DB;

    if (courseId) {
      const c = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
      if (!c) throw badRequest('Curso inválido');
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

    // Inserción en lotes; las matrículas usan el id devuelto por cada INSERT.
    const date = todayPR();
    let created = 0;
    for (let i = 0; i < valid.length; i += 50) {
      const part = valid.slice(i, i + 50);
      const res = await db.batch(part.map(({ s }) => db.prepare(
        `INSERT INTO students (first_name, last_name, birth_date, guardian_name, phone, email, notes) VALUES (?,?,?,?,?,?,?) RETURNING id`
      ).bind(...studentParams(s))));
      const ids = res.map((x) => x.results[0].id);
      const extra = [];
      ids.forEach((id, k) => {
        const s = part[k].s;
        if (s.guardian_name) extra.push(db.prepare('INSERT INTO guardians (student_id, name, phone) VALUES (?,?,?)').bind(id, s.guardian_name, s.phone));
        if (courseId) extra.push(db.prepare('INSERT OR IGNORE INTO enrollments (student_id, course_id, enrolled_on) VALUES (?,?,?)').bind(id, courseId, date));
      });
      if (extra.length) await db.batch(extra);
      created += ids.length;
    }
    await auditStmt(ctx, 'importar_estudiantes', 'student', null, { creados: created, ...summary, curso: courseId }).run();
    return json({ dry_run: false, summary, report, created });
  });
}

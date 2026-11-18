// Datos demo ficticios. Se usa desde Node (scripts/seed.mjs → SQL) y desde el Worker (botón "Resetear datos demo").
// Devuelve una lista de { sql, params } con ≤ 100 parámetros cada uno (límite de D1).
import { addDays, weekday, bandOfDay } from './time.js';
import { fakeSignature } from './png.js';

export const DEMO_USERS = [
  { username: 'admin', name: 'Administración', role: 'admin', password: 'Admin#2026' },
  { username: 'staff', name: 'Carmen Rivera', role: 'staff', password: 'Staff#2026' },
  { username: 'staff2', name: 'Luis Ortiz', role: 'staff', password: 'Staff#2026' },
];

// Tablas de datos (orden de borrado respeta llaves foráneas). Usuarios no se tocan.
export const DATA_TABLES = ['wristbands', 'payments', 'attendance', 'class_sessions', 'enrollments', 'courses', 'guardians', 'students', 'audit_log'];

const FIRST_F = ['Valeria', 'Camila', 'Sofía', 'Isabella', 'Gabriela', 'Natalia', 'Andrea', 'Paola', 'Mariana', 'Kiara', 'Yaritza', 'Keishla', 'Nicole', 'Alondra', 'Génesis', 'Adriana', 'Coral', 'Zuleyka', 'Nahomy', 'Ivelisse'];
const FIRST_M = ['Luis', 'José', 'Carlos', 'Javier', 'Joshua', 'Jean Carlos', 'Adrián', 'Daniel', 'Yadiel', 'Ángel'];
const LAST = ['Rivera', 'Rodríguez', 'Santiago', 'Colón', 'Ortiz', 'Torres', 'Vázquez', 'Pérez', 'Cruz', 'Martínez', 'González', 'Díaz', 'Hernández', 'Morales', 'Reyes', 'Ramos', 'Figueroa', 'Medina', 'Negrón', 'Maldonado', 'Meléndez', 'Rosado', 'Acevedo', 'Báez'];
const GUARD_F = ['Wanda', 'Migdalia', 'Lourdes', 'Marisol', 'Nilda', 'Brenda', 'Glorimar', 'Edwin', 'Héctor', 'Rafael'];
const NOTES = ['Alergia al maní.', 'Prefiere comunicación por WhatsApp.', 'Hermana también estudia aquí.', 'Necesita factura para reembolso.', 'Usa espejuelos.', null, null, null, null, null];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ascii(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();
}

// Convierte fecha local + "HH:MM" + minutos extra a ISO UTC (PR = UTC-4).
function localToIso(date, hhmm, plusMin = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m + 4 * 60 + plusMin);
  return d.toISOString();
}

function inserts(table, cols, rows, out, maxRowsBySize = 50) {
  const perStmt = Math.max(1, Math.min(maxRowsBySize, Math.floor(100 / cols.length)));
  for (let i = 0; i < rows.length; i += perStmt) {
    const part = rows.slice(i, i + perStmt);
    const ph = part.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    out.push({ sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph}`, params: part.flat() });
  }
}

/**
 * @param {string} today  fecha local AAAA-MM-DD
 * @param {object} opts   { users: [{username,name,role,hash,salt,iterations}] }  (solo desde Node)
 */
export function buildSeed(today, opts = {}) {
  const r = rng(20261118);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];

  for (const t of DATA_TABLES) out.push({ sql: `DELETE FROM ${t}`, params: [] });
  out.push({ sql: `DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLES.map(() => '?').join(',')})`, params: DATA_TABLES });

  if (opts.users) {
    for (const u of opts.users) {
      out.push({
        sql: `INSERT INTO users (username, name, role, password_hash, salt, iterations, active) VALUES (?,?,?,?,?,?,1)
              ON CONFLICT(username) DO UPDATE SET name=excluded.name, role=excluded.role, password_hash=excluded.password_hash,
              salt=excluded.salt, iterations=excluded.iterations, active=1`,
        params: [u.username, u.name, u.role, u.hash, u.salt, u.iterations],
      });
    }
  }

  // ---------- Estudiantes ----------
  const students = [];
  const guardians = [];
  const usedNames = new Set();
  const year = Number(today.slice(0, 4));
  for (let id = 1; id <= 30; id++) {
    let first, last;
    do {
      first = r() < 0.75 ? pick(FIRST_F) : pick(FIRST_M);
      last = `${pick(LAST)} ${pick(LAST)}`;
    } while (usedNames.has(first + last));
    usedNames.add(first + last);
    // 60% menores (8–17), 40% adultos (18–55)
    const minor = r() < 0.6;
    const age = minor ? 8 + Math.floor(r() * 10) : 18 + Math.floor(r() * 38);
    const birth = `${year - age - 1}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
    const phone = `(${r() < 0.6 ? '787' : '939'}) ${200 + Math.floor(r() * 799)}-${String(Math.floor(r() * 10000)).padStart(4, '0')}`;
    let guardianName = null;
    if (minor) {
      guardianName = `${pick(GUARD_F)} ${last.split(' ')[0]}`;
      guardians.push([id, guardianName, pick(['Madre', 'Madre', 'Padre', 'Abuela', 'Tía']), phone, null]);
      if (r() < 0.3) guardians.push([id, `${pick(GUARD_F)} ${last.split(' ')[1]}`, 'Padre', `(787) ${300 + Math.floor(r() * 600)}-${String(Math.floor(r() * 10000)).padStart(4, '0')}`, null]);
    }
    const email = `${ascii(first)}.${ascii(last.split(' ')[0])}${Math.floor(r() * 90 + 10)}@ejemplo.com`;
    students.push([id, first, last, birth, guardianName, phone, minor && r() < 0.5 ? null : email, pick(NOTES), minor]);
  }
  inserts('students', ['id', 'first_name', 'last_name', 'birth_date', 'guardian_name', 'phone', 'email', 'notes'], students.map((s) => s.slice(0, 8)), out);
  inserts('guardians', ['student_id', 'name', 'relationship', 'phone', 'email'], guardians, out);

  // ---------- Cursos ----------
  // Horarios relativos al día de hoy para que el demo siempre tenga clases "hoy".
  const wd = weekday(today);
  const d = (n) => (wd + n) % 7;
  const courses = [
    // id, program, level, days, start, end, price, instructor, ¿mayormente menores?
    [1, 1, 1, [d(0), d(3)], '16:00', '17:30', 2500, 'Shirley Cardona', true],
    [2, 1, 2, [d(1), d(5)], '17:00', '18:30', 3000, 'Shirley Cardona', true],
    [3, 2, 1, [d(0), d(2)], '18:00', '20:00', 2000, 'Ana Luisa Pagán', false],
    [4, 2, 3, [d(4)], '09:00', '12:00', 3500, 'Ana Luisa Pagán', false],
    [5, 3, 2, [d(0), d(4)], '18:30', '20:30', 2800, 'Chef Rubén Arroyo', false],
  ];
  inserts('courses', ['id', 'program_id', 'level_id', 'days', 'start_time', 'end_time', 'price_cents', 'instructor'],
    courses.map((c) => [c[0], c[1], c[2], [...c[3]].sort().join(','), c[4], c[5], c[6], c[7]]), out);

  // ---------- Matrículas ----------
  const enroll = new Map(courses.map((c) => [c[0], []]));
  const enrollRows = [];
  const startDate = addDays(today, -45);
  students.forEach((s, i) => {
    const minor = s[8];
    const pool = courses.filter((c) => c[8] === minor);
    const first = pool[i % pool.length];
    const chosen = [first];
    if (r() < 0.35) {
      const other = pick(courses.filter((c) => c !== first));
      chosen.push(other);
    }
    for (const c of chosen) {
      const status = r() < 0.06 ? 'inactivo' : 'activo';
      enrollRows.push([s[0], c[0], addDays(startDate, Math.floor(r() * 20)), status]);
      if (status === 'activo') enroll.get(c[0]).push(s[0]);
    }
  });
  inserts('enrollments', ['student_id', 'course_id', 'enrolled_on', 'status'], enrollRows, out);

  // ---------- Sesiones (últimas 2 semanas + hoy) ----------
  const sessions = [];
  let sid = 0;
  for (let back = 14; back >= 0; back--) {
    const date = addDays(today, -back);
    for (const c of courses) if (c[3].includes(weekday(date))) sessions.push({ id: ++sid, course: c, date });
  }
  inserts('class_sessions', ['id', 'course_id', 'date'], sessions.map((s) => [s.id, s.course[0], s.date]), out);

  // ---------- Asistencia, pagos y bandas ----------
  const att = [], pay = [], bands = [];
  let aid = 0;
  const staffSql = (u) => `COALESCE((SELECT id FROM users WHERE username='${u}'), (SELECT MIN(id) FROM users WHERE role='admin'))`;
  const staffPick = () => (r() < 0.45 ? 'staff' : r() < 0.8 ? 'staff2' : 'admin');
  const methodPick = () => { const x = r(); return x < 0.45 ? 'efectivo' : x < 0.85 ? 'ath_movil' : 'tarjeta'; };

  for (const s of sessions) {
    const isToday = s.date === today;
    const enrolled = enroll.get(s.course[0]);
    // Hoy: solo la primera clase tiene algunos check-ins (para ver indicadores parciales).
    const firstToday = isToday && s === sessions.find((x) => x.date === today);
    if (isToday && !firstToday) continue;
    enrolled.forEach((stuId, idx) => {
      if (isToday ? idx >= 3 : r() > 0.85) return;
      const id = ++aid;
      const student = students[stuId - 1];
      const t = localToIso(s.date, s.course[4], -10 + Math.floor(r() * 20));
      const user = staffPick();
      att.push({ row: [id, s.id, stuId, fakeSignature(id * 7919), student[8] ? 'encargado' : 'estudiante', t, user], user });
      // Hoy: el 3er estudiante solo firmó (sin pago ni banda).
      if (isToday && idx === 2) return;
      if (isToday || r() < 0.95) pay.push([id, s.course[6], methodPick(), user, s.date, t]);
      bands.push([id, 1, bandOfDay(s.date), user, t]);
    });
  }
  // Inserciones con subconsultas para resolver IDs de usuario por username.
  for (const a of att) {
    const [id, sessId, stuId, sig, by, t, user] = a.row;
    out.push({
      sql: `INSERT INTO attendance (id, session_id, student_id, signature, signed_by, signed_at, recorded_by, created_at) VALUES (?,?,?,?,?,?,${staffSql(user)},?)`,
      params: [id, sessId, stuId, sig, by, t, t],
    });
  }
  for (let i = 0; i < pay.length; i += 12) {
    const part = pay.slice(i, i + 12);
    out.push({
      sql: `INSERT INTO payments (attendance_id, amount_cents, method, received_by, local_date, created_at) VALUES ${part.map((p) => `(?,?,?,${staffSql(p[3])},?,?)`).join(',')}`,
      params: part.flatMap((p) => [p[0], p[1], p[2], p[4], p[5]]),
    });
  }
  for (let i = 0; i < bands.length; i += 20) {
    const part = bands.slice(i, i + 20);
    out.push({
      sql: `INSERT INTO wristbands (attendance_id, delivered, code, delivered_by, delivered_at) VALUES ${part.map((b) => `(?,?,?,${staffSql(b[3])},?)`).join(',')}`,
      params: part.flatMap((b) => [b[0], b[1], b[2], b[4]]),
    });
  }

  return out;
}

// Para generar un archivo .sql: incrusta parámetros como literales.
export function toSqlText(statements) {
  const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`);
  return statements.map(({ sql, params }) => {
    let i = 0;
    return sql.replace(/\?/g, () => lit(params[i++])) + ';';
  }).join('\n') + '\n';
}

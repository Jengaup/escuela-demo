// Pruebas end-to-end de la API contra `npm run dev` (http://localhost:8788).
// Antes: npm run setup:local   ·   En otra terminal: npm run dev   ·   Luego: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:8788';

class Client {
  cookie = '';
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  }
  login(u, p) { return this.req('POST', '/api/auth/login', { username: u, password: p }); }
}

const admin = new Client();
const staff = new Client();

before(async () => {
  assert.equal((await admin.login('admin', 'Admin#2026')).status, 200, 'login admin (¿corriste npm run setup:local?)');
  assert.equal((await admin.req('POST', '/api/admin/reset-demo', {})).status, 200);
  assert.equal((await staff.login('staff', 'Staff#2026')).status, 200);
});

test('auth: cookie segura, sesión y logout', async () => {
  const c = new Client();
  const r = await c.login('staff2', 'Staff#2026');
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(sc.includes(flag), flag);
  assert.equal((await c.req('GET', '/api/auth/me')).data.user.username, 'staff2');
  assert.equal((await c.req('GET', '/api/auth/me')).data.user.token_hash, undefined);
  await c.req('POST', '/api/auth/logout', {});
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
});

test('auth: rate limit por usuario', async () => {
  const c = new Client();
  const user = 'noexiste' + Date.now();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await c.login(user, 'malamala')).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  // Otro usuario desde la misma IP todavía puede entrar
  assert.equal((await new Client().login('staff', 'Staff#2026')).status, 200);
});

test('seguridad: origin ajeno, páginas protegidas y roles', async () => {
  assert.equal((await staff.req('POST', '/api/students', { first_name: 'X' }, { origin: 'https://evil.example' })).status, 403);
  const page = await fetch(BASE + '/checkin', { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal((await staff.req('GET', '/api/users')).status, 403);
  assert.equal((await staff.req('POST', '/api/courses', {})).status, 403);
  assert.equal((await staff.req('POST', '/api/admin/reset-demo', {})).status, 403);
  const html = await fetch(BASE + '/login');
  assert.ok(html.headers.get('content-security-policy'));
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
});

test('check-in manual: asistencia + pago + banda, sin cobro doble', async () => {
  const day = (await staff.req('GET', '/api/checkin/day')).data;
  assert.ok(day.sessions.length >= 1, 'hay clases hoy');
  const sess = day.sessions[day.sessions.length - 1];
  const list = (await staff.req('GET', `/api/checkin/session/${sess.id}`)).data.students;
  const st = list.find((s) => !s.attendance_id);
  assert.ok(st, 'hay un estudiante pendiente');

  const bad = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, payment: { method: 'bitcoin', amount: 1 } });
  assert.equal(bad.status, 400);
  const ok = await staff.req('POST', '/api/checkin', {
    session_id: sess.id, student_id: st.id,
    payment: { method: 'ath_movil', amount: (sess.price_cents / 100).toFixed(2) }, wristband: true,
  });
  assert.equal(ok.status, 200);
  const again = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, payment: { method: 'efectivo', amount: 1 } });
  assert.equal(again.status, 409);

  const after = (await staff.req('GET', `/api/checkin/session/${sess.id}`)).data.students.find((s) => s.id === st.id);
  assert.equal(after.check_in_method, 'manual');
  assert.equal(after.method, 'ath_movil');
  assert.equal(after.amount_cents, sess.price_cents);
  assert.equal(after.band_delivered, 1);

  const cash = (await staff.req('GET', '/api/reports/cash')).data;
  assert.ok(cash.payments.some((p) => p.student === `${st.first_name} ${st.last_name}`));
  assert.equal(cash.total, Object.values(cash.methods).reduce((a, b) => a + b, 0));

  // Solo admin anula
  assert.equal((await staff.req('DELETE', `/api/checkin/${ok.data.attendance_id}?only=pago`)).status, 403);
  assert.equal((await admin.req('DELETE', `/api/checkin/${ok.data.attendance_id}?only=pago`)).status, 200);
});

test('chapita NFC: asignar, pasar, repetir, cambiar y quitar', async () => {
  const day = (await staff.req('GET', '/api/checkin/day')).data;
  const sess = day.sessions[day.sessions.length - 1];
  const st = (await staff.req('GET', `/api/checkin/session/${sess.id}`)).data.students.find((s) => !s.attendance_id);
  assert.ok(st);
  const uid = '04:AB:CD:' + String(Date.now() % 1e6).padStart(6, '0').replace(/(..)(..)(..)/, '$1:$2:$3');
  const clean = uid.replace(/:/g, '');

  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid: 'zz' })).status, 400);
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid })).status, 404, 'chapita sin asignar');
  assert.equal((await staff.req('POST', `/api/students/${st.id}/nfc`, { uid })).status, 200);
  const det = (await staff.req('GET', `/api/students/${st.id}`)).data.student;
  assert.equal(det.nfc_uid, clean, 'se guarda normalizada');

  // Mismo UID escrito por un lector USB (sin separadores, minúsculas)
  const tap = await staff.req('POST', '/api/checkin/tap', { uid: clean.toLowerCase() });
  assert.equal(tap.status, 200);
  assert.equal(tap.data.student_id, st.id);
  // Si tiene varias clases hoy, se escoge la que está en curso o la más cercana
  assert.ok(tap.data.sessions.some((x) => x.id === tap.data.session_id));
  if (tap.data.sessions.length === 1) assert.equal(tap.data.session_id, sess.id);
  assert.equal(tap.data.already, false);
  const sid = tap.data.session_id;
  const row = (await staff.req('GET', `/api/checkin/session/${sid}`)).data.students.find((s) => s.id === st.id);
  assert.equal(row.check_in_method, 'nfc');
  assert.equal(row.method, null, 'el pago se registra aparte, al confirmar');
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid })).data.already, true);

  // Cobro inmediato después de la chapita
  const pay = await staff.req('POST', '/api/checkin', { session_id: sid, student_id: st.id, payment: { method: 'efectivo', amount: '25' }, wristband: true });
  assert.equal(pay.status, 200);

  // Otro estudiante no puede usar la misma chapita sin confirmar
  const other = 1 === st.id ? 2 : 1;
  const conflict = await staff.req('POST', `/api/students/${other}/nfc`, { uid });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.owner.id, st.id);
  assert.equal((await staff.req('POST', `/api/students/${other}/nfc`, { uid, force: true })).status, 200);
  assert.equal((await staff.req('GET', `/api/students/${st.id}`)).data.student.nfc_uid, null, 'se le quitó al anterior');

  assert.equal((await staff.req('DELETE', `/api/students/${other}/nfc`)).status, 200);
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid })).status, 404, 'chapita quitada ya no funciona');
});

test('foto del estudiante', async () => {
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: 'data:text/html;base64,AAAA' })).status, 400);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: 'data:image/jpeg;base64,' + 'A'.repeat(400 * 1024) })).status, 413);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: jpg })).status, 200);
  assert.equal((await staff.req('GET', '/api/students/3')).data.student.has_photo, 1);
  assert.equal((await staff.req('GET', '/api/students/3/photo')).data.photo, jpg);
  assert.equal((await staff.req('DELETE', '/api/students/3/photo')).status, 200);
  assert.equal((await staff.req('GET', '/api/students/3/photo')).status, 404);
});

test('estudiantes: validación, CRUD, duplicados e historial', async () => {
  const bad = await staff.req('POST', '/api/students', { first_name: '', last_name: 'X', email: 'malo', phone: '1' });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.details.first_name && bad.data.details.email && bad.data.details.phone);
  const body = { first_name: 'Test', last_name: 'Automático ' + Date.now(), birth_date: '2010-01-02', phone: '7875550000', guardians: [{ name: 'Encargada Test', relationship: 'Madre' }] };
  const c = await staff.req('POST', '/api/students', body);
  assert.equal(c.status, 201);
  assert.equal((await staff.req('POST', '/api/students', body)).status, 409);
  const d = (await staff.req('GET', `/api/students/${c.data.id}`)).data;
  assert.equal(d.student.phone, '(787) 555-0000');
  assert.equal(d.guardians.length, 1);
  assert.equal((await staff.req('PUT', `/api/students/${c.data.id}`, { ...body, active: false })).status, 200);
  assert.equal((await staff.req('DELETE', `/api/students/${c.data.id}`)).status, 403);
  assert.equal((await admin.req('DELETE', `/api/students/${c.data.id}`)).status, 200);
  // Inyección SQL en búsqueda no rompe nada
  assert.equal((await staff.req('GET', `/api/students?q=${encodeURIComponent("' OR 1=1 --")}`)).data.students.length, 0);
});

test('cursos y matrículas', async () => {
  const bad = await admin.req('POST', '/api/courses', { program_id: 1, level_id: 1, days: [], start_time: '10:00', end_time: '09:00', price: 'x', instructor: '' });
  assert.equal(bad.status, 400);
  const c = await admin.req('POST', '/api/courses', { program_id: 3, level_id: 3, days: [6], start_time: '09:00', end_time: '11:00', price: '40', instructor: 'Chef Test' });
  assert.equal(c.status, 201);
  const e = await staff.req('POST', '/api/enrollments', { student_id: 1, course_id: c.data.id });
  assert.equal(e.status, 201);
  assert.equal((await staff.req('PUT', `/api/enrollments/${e.data.id}`, { status: 'inactivo' })).status, 200);
  assert.equal((await admin.req('DELETE', `/api/courses/${c.data.id}`)).status, 200);
});

test('reportes por rango y validación de fechas', async () => {
  const r = (await staff.req('GET', '/api/reports/range')).data;
  assert.ok(r.attendance.length > 50);
  const sum = r.payments.reduce((t, p) => t + p.amount_cents, 0);
  assert.equal(sum, r.summary.reduce((t, s) => t + s.collected, 0));
  assert.equal((await staff.req('GET', '/api/reports/range?from=2026-02-30')).status, 400);
  assert.equal((await staff.req('GET', '/api/audit')).status, 403);
  assert.ok((await admin.req('GET', '/api/audit')).data.entries.length > 0);
});

test('importación: dry-run, duplicados y errores', async () => {
  const rows = [
    { full_name: 'Importada Prueba Uno', birth_date: '3/15/2011', phone: '787-555-1212' },
    { first_name: 'Importada', last_name: 'Prueba Uno', birth_date: '2011-03-15' },
    { first_name: 'Sin', last_name: '', email: 'x' },
  ];
  const dry = (await staff.req('POST', '/api/students/import', { rows, dry_run: true })).data;
  assert.deepEqual(dry.summary, { ok: 1, duplicados: 1, errores: 1 });
  assert.equal(dry.created, 0);
  const real = (await staff.req('POST', '/api/students/import', { rows, course_id: 1 })).data;
  assert.equal(real.created, 1);
  const again = (await staff.req('POST', '/api/students/import', { rows: rows.slice(0, 1) })).data;
  assert.equal(again.summary.duplicados, 1);
});

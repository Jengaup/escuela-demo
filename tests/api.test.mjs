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
  login(u, p, remember = false, headers = {}) { return this.req('POST', '/api/auth/login', { username: u, password: p, remember }, headers); }
}

const admin = new Client();
const staff = new Client();
let ref = 0;
const newRef = () => `test-${Date.now()}-${++ref}`;

async function resetDemo() {
  let step = 0, r;
  do {
    r = await admin.req('POST', '/api/admin/reset-demo', { step });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    step++;
  } while (!r.data.done);
}

// Busca un estudiante matriculado en una clase de hoy que todavía no haya llegado.
async function pendingStudent() {
  const day = (await staff.req('GET', '/api/checkin/day')).data;
  for (const sess of [...day.sessions].reverse()) {
    const st = (await staff.req('GET', `/api/checkin/session/${sess.id}`)).data.students.find((s) => !s.attendance_id && s.has_nfc);
    if (st) return { sess, st };
  }
  throw new Error('No hay estudiantes pendientes hoy');
}
const account = async (id) => (await staff.req('GET', `/api/students/${id}/account`)).data;

before(async () => {
  assert.equal((await admin.login('admin', 'Admin#2026')).status, 200, 'login admin (¿corriste npm run setup:local?)');
  await resetDemo();
  assert.equal((await staff.login('staff', 'Staff#2026')).status, 200);
});

test('auth: cookie segura, "mantener abierta", sesión y logout', async () => {
  const c = new Client();
  const r = await c.login('staff2', 'Staff#2026');
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) assert.ok(sc.includes(flag), flag);
  const long = await new Client().login('staff2', 'Staff#2026', true);
  assert.ok(long.headers.get('set-cookie').includes(`Max-Age=${30 * 24 * 3600}`), 'mantener abierta = 30 días');
  assert.equal((await c.req('GET', '/api/auth/me')).data.user.username, 'staff2');
  await c.req('POST', '/api/auth/logout', {});
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
});

test('auth: rate limit por usuario', async () => {
  const c = new Client();
  const user = 'noexiste' + Date.now();
  const codes = [];
  // IP simulada (en local se respeta cf-connecting-ip; en Cloudflare la pone el proxy y no se puede falsificar)
  const ip = { 'cf-connecting-ip': `10.9.${Date.now() % 250}.${Math.floor(Math.random() * 250)}` };
  for (let i = 0; i < 6; i++) codes.push((await c.login(user, 'malamala', false, ip)).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  assert.equal((await new Client().login('staff', 'Staff#2026', false, ip)).status, 200, 'otro usuario de la misma IP puede entrar');
});

test('seguridad: origen ajeno, páginas protegidas y roles', async () => {
  assert.equal((await staff.req('POST', '/api/students', { first_name: 'X' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(BASE + '/checkin', { redirect: 'manual' })).status, 302);
  // El staff solo ve Recepción
  for (const page of ['/', '/estudiantes', '/reportes', '/usuarios']) {
    const r = await fetch(BASE + page, { redirect: 'manual', headers: { cookie: staff.cookie } });
    assert.equal(r.status, 302, page);
    assert.ok(r.headers.get('location').endsWith('/recepcion'), page);
  }
  assert.equal((await fetch(BASE + '/recepcion', { redirect: 'manual', headers: { cookie: staff.cookie } })).status, 200);
  assert.equal((await staff.req('GET', '/api/users')).status, 403);
  assert.equal((await staff.req('POST', '/api/courses', {})).status, 403);
  assert.equal((await staff.req('POST', '/api/admin/reset-demo', { step: 0 })).status, 403);
  assert.equal((await staff.req('DELETE', '/api/payments/1')).status, 403);
  assert.equal((await staff.req('DELETE', '/api/charges/1')).status, 403);
  const html = await fetch(BASE + '/login');
  assert.ok(html.headers.get('content-security-policy'));
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
});

test('chapita: llega, cobra en el momento, sin cobro doble', async () => {
  const { st } = await pendingStudent();
  const uid = (await staff.req('GET', `/api/students/${st.id}`)).data.student.nfc_uid;
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid: 'zz' })).status, 400);
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid: '04FFFFFFFFFFFF' })).status, 404);

  const tap = await staff.req('POST', '/api/checkin/tap', { uid: uid.toLowerCase() });
  assert.equal(tap.status, 200);
  assert.equal(tap.data.student_id, st.id);
  assert.equal(tap.data.already, false);
  const sid = tap.data.session_id;
  let row = (await staff.req('GET', `/api/checkin/session/${sid}/student/${st.id}`)).data.student;
  assert.equal(row.check_in_method, 'nfc');
  assert.ok(row.class_due_cents > 0, 'la clase queda como cargo pendiente');
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid })).data.already, true);

  const cref = newRef();
  const amount = (row.class_due_cents / 100).toFixed(2);
  const pay = await staff.req('POST', '/api/checkin', { session_id: sid, student_id: st.id, wristband: true, payment: { method: 'efectivo', amount, client_ref: cref } });
  assert.equal(pay.status, 200);
  assert.equal(pay.data.student.class_due_cents, 0);
  assert.equal(pay.data.student.band_delivered, 1);
  // Mismo botón tocado dos veces (misma referencia) → no cobra doble
  const dup = await staff.req('POST', '/api/checkin', { session_id: sid, student_id: st.id, payment: { method: 'efectivo', amount, client_ref: cref } });
  assert.equal(dup.status, 409);
  const cash = (await staff.req('GET', '/api/reports/cash')).data;
  assert.equal(cash.payments.filter((p) => p.student === `${st.first_name} ${st.last_name}` && p.concept.includes('Clase')).length, 1);
});

test('paga después: queda como deuda y se cobra otro día', async () => {
  const { sess, st } = await pendingStudent();
  const before = await account(st.id);
  const r = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, wristband: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.student.check_in_method, 'manual');
  assert.equal(r.data.student.band_delivered, 1);
  let acc = await account(st.id);
  // Si tenía saldo a favor se usa solo; si no, la clase queda debiendo
  assert.equal(acc.due_cents - acc.credit_cents, before.due_cents - before.credit_cents + sess.price_cents);
  if (!acc.due_cents) return;

  const debt = acc.due_cents;
  const p = await staff.req('POST', '/api/payments', { student_id: st.id, amount: (debt / 100).toFixed(2), method: 'ath_movil', client_ref: newRef() });
  assert.equal(p.status, 201);
  assert.equal(p.data.due_cents, 0);
  acc = await account(st.id);
  assert.ok(acc.charges.every((c) => c.due_cents === 0));
  assert.ok(acc.payments[0].applied_to.includes('Clase'));
});

test('examen y matrícula: cargo aparte, ahora o después', async () => {
  const sid = 5;
  const acc0 = await account(sid);
  const c = await staff.req('POST', '/api/charges', { student_id: sid, kind: 'examen', amount: '40', course_id: acc0.courses[0]?.id });
  assert.equal(c.status, 201);
  assert.equal(c.data.due_cents, acc0.due_cents + 4000 - Math.min(acc0.credit_cents, 4000));
  const ch = (await account(sid)).charges.find((x) => x.id === c.data.id);
  assert.equal(ch.kind, 'examen');
  assert.ok(ch.description.startsWith('Examen'));
  // Pagar solo el examen aunque tenga otras deudas
  const p = await staff.req('POST', '/api/payments', { student_id: sid, amount: '40', method: 'tarjeta', apply_to: [c.data.id], client_ref: newRef() });
  assert.equal(p.status, 201);
  assert.equal((await account(sid)).charges.find((x) => x.id === c.data.id).due_cents, 0);

  assert.equal((await staff.req('POST', '/api/charges', { student_id: sid, kind: 'otro', amount: '0' })).status, 400);
  assert.equal((await staff.req('POST', '/api/charges', { student_id: sid, kind: 'regalo', amount: '5' })).status, 400);

  // Matricular en un curso con costo de matrícula crea el cargo (solo la primera vez)
  const course = (await admin.req('POST', '/api/courses', { program_id: 3, level_id: 3, days: [6], start_time: '09:00', end_time: '11:00', price: '80', exam_fee: '45', enrollment_fee: '50', instructor: 'Chef Test' })).data.id;
  const e = await staff.req('POST', '/api/enrollments', { student_id: sid, course_id: course });
  assert.ok(e.data.enrollment_charge_id);
  await staff.req('PUT', `/api/enrollments/${e.data.id}`, { status: 'inactivo' });
  const e2 = await staff.req('POST', '/api/enrollments', { student_id: sid, course_id: course });
  assert.equal(e2.data.enrollment_charge_id, null, 'reactivar no vuelve a cobrar');
});

test('pago adelantado: queda a favor y paga la próxima clase solo', async () => {
  const { sess, st } = await pendingStudent();
  const acc0 = await account(st.id);
  if (acc0.due_cents) await staff.req('POST', '/api/payments', { student_id: st.id, amount: (acc0.due_cents / 100).toFixed(2), method: 'efectivo', client_ref: newRef() });
  const adv = await staff.req('POST', '/api/payments', { student_id: st.id, amount: (3 * sess.price_cents / 100).toFixed(2), method: 'ath_movil', note: 'Pago adelantado', client_ref: newRef() });
  assert.equal(adv.data.due_cents, 0);
  const credit = adv.data.credit_cents;
  assert.ok(credit >= 3 * sess.price_cents);
  const r = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, wristband: true });
  assert.equal(r.data.student.class_due_cents, 0, 'la clase se pagó con el saldo a favor');
  assert.equal(r.data.student.credit_cents, credit - sess.price_cents);
  // Cobrar otra vez una clase ya pagada y sin deudas → 409
  const again = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, payment: { method: 'efectivo', amount: '10', client_ref: newRef() } });
  assert.equal(again.status, 409);
});

test('correcciones del admin: anular pago y anular asistencia', async () => {
  const { sess, st } = await pendingStudent();
  const acc0 = await account(st.id);
  const r = await staff.req('POST', '/api/checkin', { session_id: sess.id, student_id: st.id, payment: { method: 'efectivo', amount: (sess.price_cents / 100).toFixed(2), client_ref: newRef() } });
  const payId = (await account(st.id)).payments[0].id;
  const del = await admin.req('DELETE', `/api/payments/${payId}`);
  assert.equal(del.status, 200);
  assert.equal(del.data.due_cents, acc0.due_cents + sess.price_cents - Math.min(acc0.credit_cents, sess.price_cents) * 0 - (acc0.credit_cents ? Math.min(acc0.credit_cents, sess.price_cents) : 0));
  assert.equal((await admin.req('DELETE', `/api/checkin/${r.data.attendance_id}`)).status, 200);
  const acc = await account(st.id);
  assert.equal(acc.due_cents, acc0.due_cents, 'sin la asistencia, ya no debe esa clase');
  const audit = (await admin.req('GET', '/api/audit')).data.entries.map((e) => e.action);
  assert.ok(audit.includes('anular_pago') && audit.includes('anular_asistencia'));
});

test('chapita: asignar, cambiar y quitar', async () => {
  const st = 30;
  const uid = '04:AB:CD:' + String(Date.now() % 1e6).padStart(6, '0').replace(/(..)(..)(..)/, '$1:$2:$3');
  assert.equal((await staff.req('POST', `/api/students/${st}/nfc`, { uid })).status, 200);
  assert.equal((await staff.req('GET', `/api/students/${st}`)).data.student.nfc_uid, uid.replace(/:/g, ''));
  const conflict = await staff.req('POST', '/api/students/29/nfc', { uid });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.owner.id, st);
  assert.equal((await staff.req('POST', '/api/students/29/nfc', { uid, force: true })).status, 200);
  assert.equal((await staff.req('GET', `/api/students/${st}`)).data.student.nfc_uid, null);
  assert.equal((await staff.req('DELETE', '/api/students/29/nfc')).status, 200);
  assert.equal((await staff.req('POST', '/api/checkin/tap', { uid })).status, 404);
});

test('foto del estudiante', async () => {
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: 'data:text/html;base64,AAAA' })).status, 400);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: 'data:image/jpeg;base64,' + 'A'.repeat(400 * 1024) })).status, 413);
  assert.equal((await staff.req('PUT', '/api/students/3/photo', { photo: jpg })).status, 200);
  assert.equal((await staff.req('GET', '/api/students/3/photo')).data.photo, jpg);
  assert.equal((await staff.req('DELETE', '/api/students/3/photo')).status, 200);
  assert.equal((await staff.req('GET', '/api/students/3/photo')).status, 404);
});

test('estudiantes: validación, CRUD, duplicados', async () => {
  const bad = await staff.req('POST', '/api/students', { first_name: '', last_name: 'X', email: 'malo', phone: '1' });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.details.first_name && bad.data.details.email && bad.data.details.phone);
  const body = { first_name: 'Test', last_name: 'Automático ' + Date.now(), birth_date: '2010-01-02', phone: '7875550000', guardians: [{ name: 'Encargada Test', relationship: 'Madre' }] };
  const c = await staff.req('POST', '/api/students', body);
  assert.equal(c.status, 201);
  assert.equal((await staff.req('POST', '/api/students', body)).status, 409);
  assert.equal((await staff.req('GET', `/api/students/${c.data.id}`)).data.student.phone, '(787) 555-0000');
  assert.equal((await admin.req('DELETE', `/api/students/${c.data.id}`)).status, 200);
  assert.equal((await staff.req('GET', `/api/students?q=${encodeURIComponent("' OR 1=1 --")}`)).data.students.length, 0);
});

test('reportes: rango, deudas y validación de fechas', async () => {
  const r = (await admin.req('GET', '/api/reports/range')).data;
  assert.ok(r.attendance.length > 50);
  for (const s of r.summary) assert.equal(s.billed_cents, s.collected_cents + s.due_cents, s.course_name);
  const debts = (await admin.req('GET', '/api/reports/debts')).data.students;
  assert.ok(debts.some((d) => d.due_cents > 0), 'el demo tiene deudas');
  assert.ok(debts.some((d) => d.credit_cents > 0), 'el demo tiene saldo a favor');
  assert.equal((await admin.req('GET', '/api/reports/range?from=2026-02-30')).status, 400);
  assert.equal((await staff.req('GET', '/api/audit')).status, 403);
});

test('importación: validación, duplicados, grupos y matrícula', async () => {
  const name = 'Imp' + Date.now().toString(36);
  const rows = [
    { full_name: `${name} Uno`, birth_date: '3/15/2011', phone: '787-555-1212' },
    { first_name: name, last_name: 'Uno', birth_date: '2011-03-15' },
    { first_name: 'Sin', last_name: '', email: 'x' },
  ];
  const dry = (await staff.req('POST', '/api/students/import', { rows, dry_run: true })).data;
  assert.deepEqual(dry.summary, { ok: 1, duplicados: 1, errores: 1 });
  const many = Array.from({ length: 41 }, (_, i) => ({ first_name: 'X', last_name: String(i) }));
  assert.equal((await staff.req('POST', '/api/students/import', { rows: many })).status, 400, 'máximo 40 por envío');
  const real = (await staff.req('POST', '/api/students/import', { rows: rows.slice(0, 1), course_id: 1 })).data;
  assert.equal(real.created, 1);
  const st = (await staff.req('GET', `/api/students?q=${encodeURIComponent(name)}`)).data.students[0];
  assert.equal(st.birth_date, '2011-03-15');
  assert.ok(st.due_cents > 0, 'matrícula del curso queda como deuda');
});

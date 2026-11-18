// Prueba de pantallas en tablet y teléfono como lo usaría la recepción y el admin.
// Falla si hay errores de JavaScript o scroll horizontal. Requiere `npm run dev`.
// Uso: npm run test:ui  (capturas en tests/screenshots/)
import { mkdirSync } from 'node:fs';
import { openBrowser, login, BASE } from './browser.mjs';

const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ADMIN_PAGES = ['/', '/recepcion', '/checkin', '/estudiantes', '/cursos', '/caja', '/reportes', '/importar', '/usuarios', '/lista?course=1'];
let failed = false;
const check = (ok, msg) => { if (!ok) { console.error('✖ ' + msg); failed = true; } };

// Busca un estudiante con chapita que no haya llegado hoy (desde la página, con la sesión activa).
const pendingUid = (page) => page.evaluate(async () => {
  const day = await App.api('GET', '/api/checkin/day');
  const lists = await Promise.all(day.sessions.map((s) => App.api('GET', `/api/checkin/session/${s.id}`)));
  const all = lists.flatMap((r) => r.students);
  const times = (id) => all.filter((x) => x.id === id).length; // una sola clase hoy, para que la prueba sea predecible
  const st = all.find((x) => x.has_nfc && !x.attendance_id && !x.credit_cents && times(x.id) === 1);
  return st ? { uid: (await App.api('GET', `/api/students/${st.id}`)).student.nfc_uid, name: st.first_name, full: `${st.first_name} ${st.last_name}`, id: st.id } : null;
});
// Simula un lector USB "tipo teclado": escribe rápido y Enter.
async function scan(page, uid) {
  await page.keyboard.type(uid, { delay: 8 });
  await page.keyboard.press('Enter');
}

for (const device of ['iPad (gen 7) landscape', 'iPhone 13']) {
  const tag = device.startsWith('iPad') ? 'tablet' : 'phone';
  const { browser, ctx, errors } = await openBrowser({ device });

  // Datos demo limpios para que haya estudiantes por llegar
  const setup = await ctx.newPage();
  await login(setup, 'admin', 'Admin#2026');
  await setup.evaluate(() => App.resetDemo());
  await setup.close();
  await ctx.clearCookies();

  // ---------- Recepción (staff) ----------
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/login');
  await page.fill('#u', 'staff');
  await page.fill('#p', 'Staff#2026');
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(BASE + '/recepcion');
  await page.waitForSelector('text=Pase la chapita');
  await page.screenshot({ path: `${OUT}${tag}-recepcion-espera.png` });

  // 1) Chapita → cobra en efectivo → pantalla verde con la banda
  let t = await pendingUid(page);
  await scan(page, t.uid);
  await page.waitForSelector('section:visible >> text=Paga después');
  await page.screenshot({ path: `${OUT}${tag}-recepcion-estudiante.png` });
  check((await page.locator('section:visible h2').first().textContent()).includes(t.name), `${tag}: la chapita abrió a otro estudiante`);
  await page.click('section:visible button:has-text("Efectivo")');
  await page.waitForSelector('text=Entrégale la banda');
  await page.screenshot({ path: `${OUT}${tag}-recepcion-listo.png` });
  check(await page.locator('section:visible >> text=Cobrado').isVisible(), `${tag}: no dice "Cobrado"`);
  await page.click('section:visible button:has-text("Listo")');
  await page.waitForSelector('text=Pase la chapita');

  // 2) Chapita → paga después → queda debiendo
  t = await pendingUid(page);
  await scan(page, t.uid);
  await page.waitForSelector('section:visible >> text=Paga después');
  await page.click('section:visible button:has-text("Paga después")');
  await page.waitForSelector('section:visible >> text=Entrégale la banda');
  const owes = await page.locator('section:visible p').filter({ hasText: /debiendo|saldo a favor/ }).first().textContent();
  console.log(`${tag}: paga después → ${owes.trim()}`);
  await page.screenshot({ path: `${OUT}${tag}-recepcion-paga-despues.png` });
  await page.click('section:visible button:has-text("Listo")');

  // 3) Olvidó la chapita → buscar → otro cobro (examen) → vuelve a la ficha → cobra la clase
  t = await pendingUid(page);
  await page.click('button:has-text("Olvidó la chapita")');
  await page.fill('input[type=search]', t.full);
  await page.locator('section:visible .card').filter({ hasText: t.full }).first().click();
  await page.waitForSelector('section:visible >> text=Paga después');
  await page.click('section:visible button:has-text("Otro cobro")');
  await page.locator('button:visible', { hasText: /^Examen$/ }).click();
  await page.screenshot({ path: `${OUT}${tag}-recepcion-otro-cobro.png` });
  await page.locator('section:visible button:has-text("ATH Móvil")').click();
  await page.waitForSelector('section:visible >> text=Examen: cobrado');
  await page.click('section:visible button:has-text("Tarjeta")');
  await page.waitForSelector('text=Entrégale la banda');
  console.log(`${tag}: olvidó la chapita + examen + clase ✓`);
  await page.click('section:visible button:has-text("Listo")');

  // 4) Chapita que no existe → mensaje claro
  await scan(page, '04DEADBEEF0000');
  await page.waitForSelector('text=no está registrada');
  await page.screenshot({ path: `${OUT}${tag}-recepcion-error.png` });
  await page.click('section:visible button:has-text("Volver")');
  await page.close();

  // ---------- Admin ----------
  await ctx.clearCookies();
  const adm = await ctx.newPage();
  adm.on('dialog', (d) => d.accept());
  await login(adm, 'admin', 'Admin#2026');
  for (const p of ADMIN_PAGES) {
    await adm.goto(BASE + p);
    await adm.waitForLoadState('networkidle');
    const name = p === '/' ? 'inicio' : p.slice(1).replace(/\?.*/, '');
    await adm.screenshot({ path: `${OUT}${tag}-${name}.png`, fullPage: true });
    const overflow = await adm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 1, `${tag} ${p}: scroll horizontal de ${overflow}px`);
  }

  // Cuenta del estudiante: añadir examen como deuda y luego recibir pago
  await adm.goto(BASE + '/estudiantes?id=5');
  await adm.waitForSelector('#sTitle');
  await adm.click('.modal button:has-text("Cuenta")');
  await adm.click('.modal button:has-text("+ Añadir cargo")');
  await adm.fill('#acAmt', '40');
  await adm.click('.modal button:has-text("Paga después")');
  await adm.click('.modal button:visible:has-text("Guardar")');
  await adm.waitForSelector('#toasts div:has-text("deuda")');
  await adm.click('.modal button:has-text("Recibir pago")');
  await adm.click('.modal button:has-text("Efectivo")');
  await adm.click('.modal button:visible:has-text("Guardar")');
  await adm.waitForSelector('#toasts div:has-text("Pago registrado")');
  await adm.waitForTimeout(300);
  await adm.screenshot({ path: `${OUT}${tag}-estudiante-cuenta.png`, fullPage: true });
  console.log(`${tag}: cuenta del estudiante (cargo + pago) ✓`);

  // Asignar chapita desde la ficha
  await adm.goto(BASE + '/estudiantes');
  await adm.waitForLoadState('networkidle');
  await adm.locator('main .card button').filter({ has: adm.locator('span.pill:visible', { hasText: 'Sin chapita' }) }).first().click();
  await adm.click('.modal button:has-text("Asignar chapita")');
  await scan(adm, '04' + Date.now().toString(16).toUpperCase().slice(-12));
  await adm.waitForSelector('#toasts div:has-text("Chapita asignada")');
  console.log(`${tag}: chapita asignada desde la ficha ✓`);

  check(!errors.length, `${tag} errores JS: ${errors.join(' | ')}`);
  if (!errors.length) console.log(`✓ ${tag}: recepción + ${ADMIN_PAGES.length} pantallas de admin sin errores`);
  await browser.close();
}
process.exit(failed ? 1 : 0);

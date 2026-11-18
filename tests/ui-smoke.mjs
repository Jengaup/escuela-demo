// Recorre todas las pantallas en tablet y teléfono, hace un check-in completo y falla si hay errores de JavaScript.
// Requiere `npm run dev` corriendo. Uso: npm run test:ui  (capturas en tests/screenshots/)
import { mkdirSync } from 'node:fs';
import { openBrowser, login, BASE } from './browser.mjs';

const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PAGES = ['/', '/checkin', '/estudiantes', '/cursos', '/caja', '/reportes', '/importar', '/usuarios', '/lista?s=1'];
let failed = false;

for (const device of ['iPad (gen 7) landscape', 'iPhone 13']) {
  const tag = device.startsWith('iPad') ? 'tablet' : 'phone';
  const { browser, ctx, errors } = await openBrowser({ device });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await login(page, 'admin', 'Admin#2026');
  for (const p of PAGES) {
    await page.goto(BASE + p);
    await page.waitForLoadState('networkidle');
    const name = p === '/' ? 'inicio' : p.slice(1).replace(/\?.*/, '');
    await page.screenshot({ path: `${OUT}${tag}-${name}.png`, fullPage: true });
    // Sin scroll horizontal en la página
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) { console.error(`✖ ${tag} ${p}: scroll horizontal de ${overflow}px`); failed = true; }
  }

  // Chapita con lector tipo teclado: escribe el UID rápido + Enter, se abre la ficha y se cobra en el momento.
  await page.goto(BASE + '/checkin');
  await page.waitForLoadState('networkidle');
  const target = await page.evaluate(async () => {
    const day = await App.api('GET', '/api/checkin/day');
    for (const s of day.sessions) {
      const r = await App.api('GET', `/api/checkin/session/${s.id}`);
      const st = r.students.find((x) => x.has_nfc && !x.attendance_id);
      if (st) {
        // Foto de prueba para ver la ficha completa
        const c = document.createElement('canvas'); c.width = c.height = 200;
        const g = c.getContext('2d'); g.fillStyle = '#c7d2fe'; g.fillRect(0, 0, 200, 200);
        g.fillStyle = '#4338ca'; g.beginPath(); g.arc(100, 80, 45, 0, 7); g.fill(); g.fillRect(40, 140, 120, 60);
        await App.api('PUT', `/api/students/${st.id}/photo`, { photo: c.toDataURL('image/jpeg', 0.8) });
        const d = await App.api('GET', `/api/students/${st.id}`);
        return { uid: d.student.nfc_uid, name: st.first_name };
      }
    }
    return null;
  });
  if (target) {
    await page.keyboard.type(target.uid, { delay: 8 });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#mTitle');
    const shown = await page.textContent('#mTitle');
    if (!shown.includes(target.name)) { console.error(`✖ ${tag}: la chapita abrió a ${shown}`); failed = true; }
    await page.click('.modal button:has-text("Efectivo")');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}${tag}-checkin-chapita.png` });
    await page.click('.modal button:has-text("y confirmar")');
    await page.waitForSelector('#toasts div');
    const msg = await page.textContent('#toasts div');
    console.log(`${tag}: chapita → ${msg}`);
    if (!msg.includes('completo')) failed = true;
  } else { console.error(`✖ ${tag}: no hay estudiantes con chapita pendientes`); failed = true; }

  // Asignar chapita desde la ficha del estudiante
  await page.goto(BASE + '/estudiantes');
  await page.waitForLoadState('networkidle');
  await page.locator('main .card button').filter({ has: page.locator('span.pill:visible', { hasText: 'Sin chapita' }) }).first().click();
  await page.click('.modal button:has-text("Asignar chapita")');
  await page.keyboard.type('04' + Date.now().toString(16).toUpperCase().slice(-12), { delay: 8 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#toasts div:has-text("Chapita asignada")');
  await page.screenshot({ path: `${OUT}${tag}-estudiante-chapita.png` });
  console.log(`${tag}: chapita asignada desde la ficha`);

  // Lista imprimible
  await page.goto(BASE + '/lista?course=1');
  await page.waitForLoadState('networkidle');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${OUT}${tag}-lista-impresa.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  if (errors.length) { console.error(`✖ ${tag} errores JS:`, errors); failed = true; }
  else console.log(`✓ ${tag}: ${PAGES.length} pantallas sin errores`);
  await browser.close();
}
process.exit(failed ? 1 : 0);

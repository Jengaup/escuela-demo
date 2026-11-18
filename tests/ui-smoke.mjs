// Recorre todas las pantallas en tablet y teléfono, hace un check-in completo y falla si hay errores de JavaScript.
// Requiere `npm run dev` corriendo. Uso: npm run test:ui  (capturas en tests/screenshots/)
import { mkdirSync } from 'node:fs';
import { openBrowser, login, BASE } from './browser.mjs';

const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PAGES = ['/', '/checkin', '/estudiantes', '/cursos', '/caja', '/reportes', '/importar', '/usuarios'];
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
    const name = p === '/' ? 'inicio' : p.slice(1);
    await page.screenshot({ path: `${OUT}${tag}-${name}.png`, fullPage: true });
    // Sin scroll horizontal en la página
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) { console.error(`✖ ${tag} ${p}: scroll horizontal de ${overflow}px`); failed = true; }
  }

  // Check-in completo de un estudiante pendiente
  await page.goto(BASE + '/checkin');
  await page.waitForLoadState('networkidle');
  const pending = page.locator('main .grid button.card').filter({ has: page.locator('span', { hasText: /^Firma$/ }) });
  if (await pending.count()) {
    await pending.first().click();
    const canvas = page.locator('canvas');
    await canvas.waitFor();
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + 30, b.y + 100);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(b.x + 30 + i * 8, b.y + 100 + Math.sin(i / 2) * 25);
    await page.mouse.up();
    await page.click('.modal button:has-text("Efectivo")');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}${tag}-checkin-modal.png` });
    await page.click('.modal button:has-text("Confirmar")');
    await page.waitForSelector('#toasts div');
    const msg = await page.textContent('#toasts div');
    console.log(`${tag}: ${msg}`);
    if (!msg.includes('completo')) failed = true;
  }

  if (errors.length) { console.error(`✖ ${tag} errores JS:`, errors); failed = true; }
  else console.log(`✓ ${tag}: ${PAGES.length} pantallas sin errores`);
  await browser.close();
}
process.exit(failed ? 1 : 0);

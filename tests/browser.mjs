// Abre Chromium (Playwright) contra `wrangler pages dev`.
// Las librerías del CDN (jsDelivr) se sirven desde node_modules para poder probar sin internet.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));

export const BASE = process.env.BASE_URL || 'http://localhost:8788';

export async function openBrowser({ device = 'iPad (gen 7) landscape' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices[device], acceptDownloads: true });
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, (route) => {
    const m = route.request().url().match(/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    const file = m && `${root}node_modules/${m[1]}/${m[2]}`;
    if (file && existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: 'application/javascript' });
    return route.abort();
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  });
  return { browser, ctx, errors };
}

export async function login(page, username, password) {
  await page.goto(BASE + '/login');
  await page.fill('#u', username);
  await page.fill('#p', password);
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(BASE + '/');
}

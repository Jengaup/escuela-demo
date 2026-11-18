// Genera seed/seed.sql con datos demo + usuarios demo (contraseñas con PBKDF2).
// Uso: node scripts/seed.mjs  →  luego wrangler d1 execute ... --file seed/seed.sql
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSeed, toSqlText, DEMO_USERS } from '../src/seed.js';
import { hashPassword } from '../src/crypto.js';
import { todayPR } from '../src/time.js';

const today = process.argv[2] || todayPR();
const users = [];
for (const u of DEMO_USERS) {
  const h = await hashPassword(u.password);
  users.push({ ...u, hash: h.hash, salt: h.salt, iterations: h.iterations });
}
const sql = toSqlText(buildSeed(today, { users }));
mkdirSync(new URL('../seed/', import.meta.url), { recursive: true });
writeFileSync(new URL('../seed/seed.sql', import.meta.url), sql);
console.log(`seed/seed.sql generado para ${today} (${(sql.length / 1024).toFixed(0)} KB)`);

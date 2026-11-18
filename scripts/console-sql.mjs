// Genera setup/consola-d1.sql: todas las migraciones + usuarios demo, para pegar en la consola de D1
// del dashboard de Cloudflare (sin instalar nada en la computadora).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hashPassword } from '../src/crypto.js';
import { DEMO_USERS } from '../src/seed.js';

const dir = new URL('../migrations/', import.meta.url);
const strip = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+--.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const parts = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => strip(readFileSync(new URL(f, dir), 'utf8')));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let users = '';
for (const u of DEMO_USERS) {
  const h = await hashPassword(u.password);
  users += `INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES (${q(u.username)}, ${q(u.name)}, ${q(u.role)}, ${q(h.hash)}, ${q(h.salt)}, ${h.iterations});\n`;
}
writeFileSync(new URL('../setup/consola-d1.sql', import.meta.url), parts.join('\n\n') + '\n\n' + users);
console.log('setup/consola-d1.sql generado');

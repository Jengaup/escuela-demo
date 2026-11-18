// Crea (o actualiza la contraseña de) un usuario sin cargar datos demo.
// Uso: node scripts/create-user.mjs <usuario> "<Nombre>" <admin|staff> <contraseña> [--remote]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { hashPassword } from '../src/crypto.js';

const [username, name, role, password] = process.argv.slice(2);
const remote = process.argv.includes('--remote');
if (!username || !name || !['admin', 'staff'].includes(role) || !password || password.length < 8) {
  console.error('Uso: node scripts/create-user.mjs <usuario> "<Nombre>" <admin|staff> <contraseña (mín. 8)> [--remote]');
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) { console.error('Usuario inválido'); process.exit(1); }
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const h = await hashPassword(password);
const sql = `INSERT INTO users (username, name, role, password_hash, salt, iterations, active)
VALUES (${q(username)}, ${q(name)}, ${q(role)}, ${q(h.hash)}, ${q(h.salt)}, ${h.iterations}, 1)
ON CONFLICT(username) DO UPDATE SET name=excluded.name, role=excluded.role, password_hash=excluded.password_hash,
salt=excluded.salt, iterations=excluded.iterations, active=1;\n`;
mkdirSync(new URL('../seed/', import.meta.url), { recursive: true });
const file = new URL('../seed/user.sql', import.meta.url).pathname;
writeFileSync(file, sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'escuela-demo', remote ? '--remote' : '--local', '--file', file], { stdio: 'inherit' });
writeFileSync(file, ''); // no dejar el hash en disco
console.log(`Usuario ${username} (${role}) listo en la base ${remote ? 'remota' : 'local'}.`);

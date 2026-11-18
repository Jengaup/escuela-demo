import { HttpError } from './http.js';
import { randomHex, sha256Hex } from './crypto.js';

export const COOKIE_NAME = 'sid';
export const SESSION_HOURS = 12;

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSec) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(new Date().toISOString()),
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').bind(tokenHash, userId, expires),
  ]);
  return { token, cookie: sessionCookie(token, SESSION_HOURS * 3600) };
}

// Devuelve el usuario de la sesión o null. Token en cookie; en DB solo se guarda su hash.
export async function getSessionUser(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
  ).bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

export async function destroySession(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE_NAME];
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return sessionCookie('', 0);
}

export function requireAdmin(ctx) {
  if (ctx.user?.role !== 'admin') throw new HttpError(403, 'Solo administradores');
}

// Rate limit de login: máx. 5 fallos en 15 min por usuario y 20 por IP
// (varias tablets de la escuela suelen compartir la misma IP pública).
export const RL_WINDOW_MIN = 15;
export const RL_MAX_USER = 5;
export const RL_MAX_IP = 20;

export async function isRateLimited(env, limits) {
  const since = new Date(Date.now() - RL_WINDOW_MIN * 60000).toISOString();
  for (const { key, max } of limits) {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE rl_key = ? AND created_at > ?').bind(key, since).first();
    if (r.n >= max) return true;
  }
  return false;
}

export async function recordFailure(env, keys) {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(since),
    ...keys.map((k) => env.DB.prepare('INSERT INTO login_attempts (rl_key) VALUES (?)').bind(k)),
  ]);
}

export async function clearFailures(env, keys) {
  await env.DB.batch(keys.map((k) => env.DB.prepare('DELETE FROM login_attempts WHERE rl_key = ?').bind(k)));
}

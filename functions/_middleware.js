import { getSessionUser } from '../src/auth.js';

const CSP = [
  "default-src 'self'",
  // Alpine (build estándar) requiere 'unsafe-eval'; los scripts inline de cada página, 'unsafe-inline'.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const PUBLIC_PATHS = new Set(['/login', '/login.html', '/favicon.svg']);

function withSecurityHeaders(res) {
  const r = new Response(res.body, res);
  r.headers.set('Content-Security-Policy', CSP);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set('Referrer-Policy', 'same-origin');
  r.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  r.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return r;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Protección CSRF adicional a SameSite=Strict: las mutaciones deben venir del mismo origen.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: 'Origen no permitido' }), {
        status: 403, headers: { 'content-type': 'application/json' },
      }));
    }
  }

  // Páginas HTML protegidas: sin sesión se redirige al login.
  const isPage = !path.startsWith('/api/') && !path.startsWith('/assets/') && (path.endsWith('.html') || !path.includes('.'));
  if (isPage && !PUBLIC_PATHS.has(path)) {
    const user = await getSessionUser(request, env);
    if (!user) return Response.redirect(`${url.origin}/login`, 302);
    // El staff solo usa Recepción (y la lista imprimible); el resto es para el admin.
    if (user.role !== 'admin' && !/^\/(recepcion|lista)(\.html)?$/.test(path)) return Response.redirect(`${url.origin}/recepcion`, 302);
  }

  return withSecurityHeaders(await next());
}

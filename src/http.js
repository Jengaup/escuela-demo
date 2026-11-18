export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg = 'No encontrado') => new HttpError(404, msg);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const MAX_BODY = 2 * 1024 * 1024; // 2 MB (importaciones grandes)

export async function readJson(request, maxBytes = MAX_BODY) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'Se esperaba JSON');
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Solicitud demasiado grande');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Solicitud demasiado grande');
  try {
    const data = JSON.parse(text || '{}');
    if (data === null || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw badRequest('JSON inválido');
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
}

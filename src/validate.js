import { badRequest } from './http.js';

// Validadores de servidor. Cada uno devuelve el valor normalizado o lanza 400 con mensaje en español.
// Uso: const v = new V(body); const name = v.str('name', { required: true, max: 80 }); v.done();

export class V {
  constructor(src) {
    this.src = src || {};
    this.errors = {};
  }
  fail(field, msg) {
    this.errors[field] = msg;
    return undefined;
  }
  has(field) {
    const x = this.src[field];
    return !(x === undefined || x === null || (typeof x === 'string' && x.trim() === ''));
  }
  str(field, { required = false, max = 200, min = 0, label = field } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const x = this.src[field];
    if (typeof x !== 'string' && typeof x !== 'number') return this.fail(field, `${label} inválido`);
    const s = String(x).trim().replace(/\s+/g, ' ');
    if (s.length < min) return this.fail(field, `${label} debe tener al menos ${min} caracteres`);
    if (s.length > max) return this.fail(field, `${label} excede ${max} caracteres`);
    return s;
  }
  text(field, { max = 2000, label = field } = {}) {
    if (!this.has(field)) return null;
    const x = this.src[field];
    if (typeof x !== 'string') return this.fail(field, `${label} inválido`);
    const s = x.trim();
    if (s.length > max) return this.fail(field, `${label} excede ${max} caracteres`);
    return s;
  }
  int(field, { required = false, min = -Infinity, max = Infinity, label = field } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const n = Number(this.src[field]);
    if (!Number.isInteger(n) || n < min || n > max) return this.fail(field, `${label} inválido`);
    return n;
  }
  bool(field) {
    const x = this.src[field];
    return x === true || x === 1 || x === '1' || x === 'true';
  }
  oneOf(field, values, { required = false, label = field } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const x = this.src[field];
    if (!values.includes(x)) return this.fail(field, `${label} inválido`);
    return x;
  }
  date(field, { required = false, label = field } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const s = String(this.src[field]).trim();
    if (!isIsoDate(s)) return this.fail(field, `${label} debe ser una fecha válida (AAAA-MM-DD)`);
    return s;
  }
  time(field, { required = false, label = field } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const s = String(this.src[field]).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return this.fail(field, `${label} debe tener formato HH:MM`);
    return s;
  }
  email(field, { required = false, label = 'Email' } = {}) {
    const s = this.str(field, { required, max: 120, label });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return this.fail(field, `${label} inválido`);
    return s ? s.toLowerCase() : s;
  }
  phone(field, { required = false, label = 'Teléfono' } = {}) {
    const s = this.str(field, { required, max: 30, label });
    if (!s) return s;
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return this.fail(field, `${label} inválido`);
    return normalizePhone(s);
  }
  // Dinero en dólares (número o "12.50") -> centavos enteros
  money(field, { required = false, max = 100000, label = 'Monto' } = {}) {
    if (!this.has(field)) return required ? this.fail(field, `${label} es requerido`) : null;
    const cents = toCents(this.src[field]);
    if (cents === null || cents < 0 || cents > max * 100) return this.fail(field, `${label} inválido`);
    return cents;
  }
  done() {
    if (Object.keys(this.errors).length) {
      const first = Object.values(this.errors)[0];
      throw badRequest(first, this.errors);
    }
  }
}

export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

export function toCents(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 100) : null;
  if (typeof x !== 'string') return null;
  const s = x.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

export function normalizePhone(s) {
  const d = String(s).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(s).trim();
}

// UID de chapita NFC: el lector puede entregarlo como "04:A2:1B:..." (Web NFC) o "04A21B..." / "0012345678" (lector USB).
export function normalizeUid(x) {
  if (typeof x !== 'string' && typeof x !== 'number') return null;
  const s = String(x).toUpperCase().replace(/[\s:\-]/g, '');
  return /^[0-9A-F]{4,32}$/.test(s) ? s : null;
}

export function idParam(params, key = 'id') {
  const n = Number(params[key]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('ID inválido');
  return n;
}

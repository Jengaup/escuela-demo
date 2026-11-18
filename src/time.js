// Puerto Rico usa AST (UTC-4) todo el año, sin horario de verano.
const PR_OFFSET_MS = -4 * 60 * 60 * 1000;

export const nowIso = () => new Date().toISOString();

export function todayPR(now = Date.now()) {
  return new Date(now + PR_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

// Color de banda del día: rota por fecha para que no se reutilice la banda de ayer.
export const BAND_COLORS = ['Azul', 'Verde', 'Amarillo', 'Rojo', 'Morado', 'Anaranjado', 'Rosa'];

export function bandOfDay(dateStr) {
  const days = Math.floor(new Date(dateStr + 'T12:00:00Z').getTime() / 86400000);
  const color = BAND_COLORS[days % BAND_COLORS.length];
  return `${color}-${dateStr.slice(5).replace('-', '')}`; // ej. "Azul-1118"
}

// Utilidades compartidas: API, formato, navegación y avisos.
(function () {
  const NAV = [
    { href: '/', key: 'inicio', label: 'Inicio' },
    { href: '/checkin', key: 'checkin', label: 'Check-in' },
    { href: '/estudiantes', key: 'estudiantes', label: 'Estudiantes' },
    { href: '/cursos', key: 'cursos', label: 'Cursos' },
    { href: '/caja', key: 'caja', label: 'Cuadre de caja' },
    { href: '/reportes', key: 'reportes', label: 'Reportes' },
    { href: '/importar', key: 'importar', label: 'Importar' },
    { href: '/usuarios', key: 'usuarios', label: 'Usuarios', admin: true },
  ];

  const METHOD_LABEL = { efectivo: 'Efectivo', ath_movil: 'ATH Móvil', tarjeta: 'Tarjeta' };
  const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new Error('Sin conexión. Verifica el internet e intenta de nuevo.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      location.href = '/login';
      throw new Error(data.error || 'Sesión expirada');
    }
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.details = data.details;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const money = (cents) =>
    (Number(cents || 0) / 100).toLocaleString('es-PR', { style: 'currency', currency: 'USD' });

  function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!d) return '';
    return new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-PR', opts);
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-PR', { timeZone: 'America/Puerto_Rico', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
  }
  function age(birth) {
    if (!birth) return null;
    const b = new Date(birth + 'T12:00:00'), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  function todayPR() {
    return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(d, n) {
    const x = new Date(d + 'T12:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }
  const daysLabel = (days) => String(days || '').split(',').filter(Boolean).map((d) => DAY_NAMES[d]).join(', ');

  function toast(msg, type = 'ok') {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'fixed z-[100] bottom-4 inset-x-4 sm:left-auto sm:right-4 sm:w-96 flex flex-col gap-2 no-print';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `rounded-xl px-4 py-3 shadow-lg text-white text-base font-medium ${type === 'error' ? 'bg-red-600' : 'bg-stone-900'}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
  }

  let mePromise;
  const me = () => (mePromise ||= api('GET', '/api/auth/me'));

  async function logout() {
    await api('POST', '/api/auth/logout', {}).catch(() => {});
    location.href = '/login';
  }

  async function shell(active) {
    const host = document.getElementById('shell');
    if (!host) return;
    const { user } = await me();
    const links = NAV.filter((n) => !n.admin || user.role === 'admin')
      .map((n) => `<a href="${n.href}" class="nav-link ${n.key === active ? 'nav-active' : ''}" ${n.key === active ? 'aria-current="page"' : ''}>${n.label}</a>`)
      .join('');
    host.innerHTML = `
      <header class="bg-white border-b border-stone-200 no-print">
        <div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href="/" class="flex items-center gap-2 font-semibold text-stone-900">
            <span class="w-8 h-8 rounded-lg bg-accent text-white grid place-items-center text-sm font-bold">E</span>
            <span class="hidden sm:inline">Escuela de Artes</span>
          </a>
          <div class="ml-auto flex items-center gap-3 text-sm">
            <span class="text-stone-600 truncate max-w-[10rem]">${escapeHtml(user.name)}
              <span class="ml-1 text-xs uppercase tracking-wide text-stone-400">${user.role}</span></span>
            <button type="button" id="logoutBtn" class="btn-ghost">Salir</button>
          </div>
        </div>
        <nav class="max-w-6xl mx-auto px-2 flex gap-1 overflow-x-auto pb-2 scrollbar-none" aria-label="Principal">${links}</nav>
      </header>`;
    document.getElementById('logoutBtn').onclick = logout;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Exporta filas (array de objetos) a CSV con BOM para que Excel respete acentos.
  function downloadCsv(filename, rows) {
    if (!rows.length) return toast('No hay datos para exportar', 'error');
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Evita inyección de fórmulas en Excel
      const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  // Exporta varias hojas a .xlsx (requiere SheetJS cargado en la página).
  function downloadXlsx(filename, sheets) {
    if (!window.XLSX) return toast('No se pudo cargar el exportador de Excel', 'error');
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'Sin datos' }]), name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename);
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
  }

  window.App = { api, money, fmtDate, fmtDateTime, fmtTime, age, todayPR, addDays, daysLabel, toast, me, shell, logout, escapeHtml, downloadCsv, downloadXlsx, METHOD_LABEL, DAY_NAMES };

  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.dataset.page;
    if (active) shell(active).catch(() => {});
  });
})();

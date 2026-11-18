// Lectura de chapitas NFC con dos tipos de lector:
//  1) Web NFC (Chrome en Android con NFC): hay que activarlo con un toque (requisito del navegador).
//  2) Lector USB/Bluetooth "tipo teclado" (sirve en iPad, Android y computadora): escribe el número
//     de la chapita muy rápido y termina con Enter. Se distingue de una persona escribiendo por la velocidad.
window.NfcInput = (() => {
  const listeners = new Set();
  let last = { uid: '', at: 0 };
  let webNfcOn = false;

  function emit(raw) {
    const uid = String(raw || '').toUpperCase().replace(/[\s:\-]/g, '');
    if (!/^[0-9A-F]{4,32}$/.test(uid)) return;
    const now = Date.now();
    if (uid === last.uid && now - last.at < 2500) return; // Web NFC repite la lectura mientras la chapita sigue cerca
    last = { uid, at: now };
    listeners.forEach((fn) => fn(uid));
  }

  // ---- Lector tipo teclado ----
  const MAX_GAP_MS = 60;
  let buf = '';
  let lastKey = 0;
  let fastKeys = 0;
  document.addEventListener('keydown', (e) => {
    if (!listeners.size) return;
    const now = performance.now();
    if (e.key === 'Enter') {
      if (buf.length >= 6 && fastKeys >= buf.length - 1 && now - lastKey < MAX_GAP_MS * 3) {
        e.preventDefault();
        e.stopPropagation();
        const t = e.target;
        // Si el lector escribió dentro de un campo (ej. el buscador), se borra lo que escribió.
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && typeof t.value === 'string' && t.value.endsWith(buf)) {
          t.value = t.value.slice(0, -buf.length);
          t.dispatchEvent(new Event('input', { bubbles: true }));
        }
        emit(buf);
      }
      buf = '';
      fastKeys = 0;
      return;
    }
    if (e.key.length !== 1 || !/[0-9a-fA-F:\-]/.test(e.key)) { buf = ''; fastKeys = 0; return; }
    if (now - lastKey <= MAX_GAP_MS && buf) { buf += e.key; fastKeys++; }
    else { buf = e.key; fastKeys = 0; }
    lastKey = now;
  }, true);

  return {
    get webNfcSupported() { return 'NDEFReader' in window; },
    get webNfcOn() { return webNfcOn; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Debe llamarse desde un toque del usuario (botón).
    async startWebNfc() {
      if (!('NDEFReader' in window)) throw new Error('Este dispositivo no tiene lector NFC compatible. Usa un lector USB.');
      if (webNfcOn) return;
      const reader = new NDEFReader();
      await reader.scan();
      reader.onreading = (e) => emit(e.serialNumber);
      reader.onreadingerror = () => window.App?.toast('No se pudo leer la chapita. Acércala otra vez.', 'error');
      webNfcOn = true;
    },
    simulate: emit, // para el modo demo y las pruebas
  };
})();

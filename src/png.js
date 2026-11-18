// Codificador PNG mínimo (1 bit, deflate "stored") para generar firmas de demo sin canvas.
// Funciona igual en Workers y en Node.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

function u32be(out, off, n) {
  out[off] = (n >>> 24) & 255; out[off + 1] = (n >>> 16) & 255; out[off + 2] = (n >>> 8) & 255; out[off + 3] = n & 255;
}

// Escribe un chunk PNG (largo + tipo + datos + CRC) en `out` a partir de `off`. Devuelve el nuevo offset.
function writeChunk(out, off, type, data) {
  u32be(out, off, data.length);
  for (let i = 0; i < 4; i++) out[off + 4 + i] = type.charCodeAt(i);
  out.set(data, off + 8);
  u32be(out, off + 8 + data.length, crc32(out.subarray(off + 4, off + 8 + data.length)));
  return off + 12 + data.length;
}

function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    out[o++] = i + 65535 >= raw.length ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >>> 8; out[o++] = ~len & 255; out[o++] = (~len >>> 8) & 255;
    out.set(raw.subarray(i, i + len), o);
    o += len;
    if (len === 0) break;
  }
  u32be(out, o, adler32(raw));
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// mask: Uint8Array de width*height (1 = tinta). Paleta: 0 = blanco, 1 = gris oscuro.
export function encodePng1bit(width, height, mask) {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const off = y * (rowBytes + 1); // byte 0 de cada fila = filtro "ninguno"
    for (let x = 0; x < width; x++) if (mask[y * width + x]) raw[off + 1 + (x >> 3)] |= 0x80 >> (x & 7);
  }
  const ihdr = new Uint8Array(13);
  u32be(ihdr, 0, width); u32be(ihdr, 4, height);
  ihdr.set([1, 3, 0, 0, 0], 8); // 1 bit, paleta
  const plte = new Uint8Array([255, 255, 255, 30, 41, 59]);
  const idat = zlibStored(raw);
  const out = new Uint8Array(8 + 25 + 18 + 12 + idat.length + 12);
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = writeChunk(out, 8, 'IHDR', ihdr);
  o = writeChunk(out, o, 'PLTE', plte);
  o = writeChunk(out, o, 'IDAT', idat);
  writeChunk(out, o, 'IEND', new Uint8Array(0));
  return 'data:image/png;base64,' + toBase64(out);
}

// Firma "manuscrita" determinística a partir de una semilla.
export function fakeSignature(seed) {
  const W = 240, H = 80;
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const f1 = 0.05 + rnd() * 0.08, f2 = 0.15 + rnd() * 0.2, a1 = 12 + rnd() * 10, a2 = 4 + rnd() * 6, ph = rnd() * 6;
  const pts = [];
  for (let x = 20; x < W - 20; x++) {
    const y = H / 2 + a1 * Math.sin(x * f1 + ph) + a2 * Math.sin(x * f2 + ph * 2) - (x - 20) * 0.08;
    pts.push([x, y]);
  }
  // trazo inferior tipo rúbrica
  const ruby = [];
  for (let x = 30; x < W - 40; x += 1) ruby.push([x, H - 14 + 3 * Math.sin(x * 0.06 + ph)]);
  const all = pts.concat(ruby);
  const mask = new Uint8Array(W * H);
  for (const [px, py] of all) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round(px + dx), y = Math.round(py + dy);
      if (x >= 0 && x < W && y >= 0 && y < H) mask[y * W + x] = 1;
    }
  }
  return encodePng1bit(W, H, mask);
}

// Pocas variantes memorizadas: generar el seed debe caber en el límite de CPU del plan gratis de Workers.
const cache = new Map();
export function demoSignature(n, variants = 8) {
  const k = (n % variants) + 1;
  if (!cache.has(k)) cache.set(k, fakeSignature(k * 7919));
  return cache.get(k);
}

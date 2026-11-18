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

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type, data) {
  const td = [...type].map((c) => c.charCodeAt(0)).concat([...data]);
  return [...u32(data.length), ...td, ...u32(crc32(td))];
}

function zlibStored(raw) {
  const out = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const block = raw.subarray(i, i + 65535);
    const last = i + 65535 >= raw.length ? 1 : 0;
    out.push(last, block.length & 255, block.length >>> 8, ~block.length & 255, (~block.length >>> 8) & 255);
    for (const b of block) out.push(b);
  }
  out.push(...u32(adler32(raw)));
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// bitmap: función (x,y) => boolean (true = tinta). Paleta: 0 = blanco, 1 = gris oscuro.
export function encodePng1bit(width, height, isInk) {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const off = y * (rowBytes + 1);
    raw[off] = 0; // filtro: ninguno
    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) raw[off + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = [...u32(width), ...u32(height), 1, 3, 0, 0, 0]; // 1 bit, paleta
  const plte = [255, 255, 255, 30, 41, 59];
  const bytes = [
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', ihdr),
    ...chunk('PLTE', plte),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', []),
  ];
  return 'data:image/png;base64,' + toBase64(bytes);
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
  const ink = new Set();
  for (const [px, py] of all) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round(px + dx), y = Math.round(py + dy);
      if (x >= 0 && x < W && y >= 0 && y < H) ink.add(y * W + x);
    }
  }
  return encodePng1bit(W, H, (x, y) => ink.has(y * W + x));
}

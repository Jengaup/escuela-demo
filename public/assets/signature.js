// Panel de firma táctil (pointer events: dedo, stylus o mouse).
window.SignaturePad = class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.drawing = false;
    this.resize = this.resize.bind(this);
    canvas.addEventListener('pointerdown', (e) => this.start(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => this.end()));
    window.addEventListener('resize', this.resize);
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  start(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drawing = true;
    this.strokes.push([this.pos(e)]);
    this.redraw();
  }
  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    this.strokes[this.strokes.length - 1].push(this.pos(e));
    this.redraw();
  }
  end() {
    if (this.drawing) {
      this.drawing = false;
      this.onChange?.();
    }
  }
  redraw(ctx = this.ctx, scale = 1) {
    const r = this.canvas.getBoundingClientRect();
    if (ctx === this.ctx) ctx.clearRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.5 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e293b';
    for (const s of this.strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0][0] * scale, s[0][1] * scale);
      if (s.length === 1) ctx.lineTo(s[0][0] * scale + 0.1, s[0][1] * scale);
      for (const [x, y] of s.slice(1)) ctx.lineTo(x * scale, y * scale);
      ctx.stroke();
    }
  }
  clear() {
    this.strokes = [];
    this.redraw();
    this.onChange?.();
  }
  isEmpty() {
    // Exige un trazo mínimo para evitar "firmas" accidentales de un toque.
    return this.strokes.reduce((n, s) => n + s.length, 0) < 8;
  }
  // Exporta PNG compacto (máx. 600 px de ancho, fondo blanco).
  toDataURL() {
    const r = this.canvas.getBoundingClientRect();
    const scale = Math.min(1, 600 / r.width);
    const out = document.createElement('canvas');
    out.width = Math.round(r.width * scale);
    out.height = Math.round(r.height * scale);
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out.width, out.height);
    this.redraw(c, scale);
    return out.toDataURL('image/png');
  }
  destroy() {
    window.removeEventListener('resize', this.resize);
  }
};

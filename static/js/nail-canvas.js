/**
 * nail-canvas.js — Flat per-finger nail design canvases.
 *
 * Each of the 5 nail canvases is 200×280px (internal resolution).
 * The active nail is shown larger; thumbnails show smaller previews via CSS.
 * All drawing is clipped to the nail shape — paint cannot bleed outside.
 */

// ─── Nail shape SVG paths (100×100 box, y=0 tip, y=100 cuticle) ──────
export const NAIL_SHAPES = {
  round:    "M50,4 C74,4 96,20 96,44 L96,78 C92,92 74,100 50,100 C26,100 8,92 4,78 L4,44 C4,20 26,4 50,4 Z",
  oval:     "M50,0 C72,0 94,14 96,38 L96,78 C92,92 72,100 50,100 C28,100 8,92 4,78 L4,38 C6,14 28,0 50,0 Z",
  square:   "M7,2 L93,2 L93,78 C89,92 72,100 50,100 C28,100 11,92 7,78 Z",
  squoval:  "M15,2 L85,2 C93,2 96,8 96,16 L96,78 C92,92 72,100 50,100 C28,100 8,92 4,78 L4,16 C4,8 7,2 15,2 Z",
  almond:   "M50,0 C66,4 86,22 92,46 L92,78 C88,92 70,100 50,100 C30,100 12,92 8,78 L8,46 C14,22 34,4 50,0 Z",
  stiletto: "M50,0 C60,8 78,32 86,58 L86,78 C82,92 66,100 50,100 C34,100 18,92 14,78 L14,58 C22,32 40,8 50,0 Z",
  ballerina:"M26,2 L74,2 C82,14 92,40 94,66 L94,78 C90,92 70,100 50,100 C30,100 10,92 6,78 L6,66 C8,40 18,14 26,2 Z",
  lipstick: "M6,2 L94,16 C97,24 97,50 96,70 L96,80 C92,92 70,100 50,100 C30,100 8,92 4,80 L4,70 C3,50 4,26 6,2 Z",
};

// ─── Professional nail polish color palette (by category) ────────────
export const COLOR_PALETTE = {
  pinks: [
    '#F9DDE4','#F4B8CB','#EE8FAE','#E56B93','#D44A7C',
    '#C4778A','#A85070','#8B3556','#FFD4E4','#FFA8C0',
    '#FF7BA8','#E0558E',
  ],
  reds: [
    '#FF4455','#E8192A','#C40A18','#8B0000','#FF6B6B',
    '#F04040','#CC2233','#991122','#FF9999','#FF3344',
    '#D41E2D','#B01020',
  ],
  bold: [
    '#1A1A1A','#2D2030','#4A1060','#7A2080','#AA44BB',
    '#3355CC','#1122AA','#001466','#226644','#003322',
    '#888888','#CCCCCC',
  ],
  nudes: [
    '#F9EDE8','#F4DDD0','#ECCFC0','#E0BA9E','#D4A882',
    '#C89468','#BC8055','#A06840','#FFF0EA','#FFE4D4',
    '#F5D0BC','#ECC0A8',
  ],
};

// ─── State ────────────────────────────────────────────────────────────
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

let nailCanvases = {}; // { finger: { canvas, ctx, undoStack } }
let activeNailEl   = null; // <canvas id="active-nail-canvas">
let activeCtx      = null;
let activeFingerName = 'thumb';
let currentShape   = 'oval';
let currentCat     = 'pinks';
let isPainting     = false;
let lastPt         = { x: 0, y: 0 };

export let finishType = 'glossy'; // exported for generator

export const BrushState = {
  size: 8,
  opacity: 1.0,
  color: '#E8B4BC',
  eraserSize: 20,
};

// ─── Clip path in canvas pixel space ─────────────────────────────────
function getNailClipPath(shapeName, W, H) {
  const transform = new DOMMatrix([W / 100, 0, 0, H / 100, 0, 0]);
  const base   = new Path2D(NAIL_SHAPES[shapeName] || NAIL_SHAPES.oval);
  const result = new Path2D();
  result.addPath(base, transform);
  return result;
}

// Paint default warm pink base inside nail shape
function paintDefaultBase(ctx, shapeName, W, H) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.clip(getNailClipPath(shapeName, W, H));
  ctx.fillStyle = '#F5D0BC'; // warm nude — gives the AI a starting point
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ─── Public: initialize all 5 nail canvases ──────────────────────────
export function initNailCanvases(shapeName) {
  currentShape = shapeName || 'oval';
  activeNailEl = document.getElementById('active-nail-canvas');
  activeCtx    = activeNailEl.getContext('2d');

  FINGERS.forEach((finger) => {
    const canvas = document.querySelector(`.nail-thumb-canvas[data-finger="${finger}"]`);
    const ctx    = canvas.getContext('2d');
    nailCanvases[finger] = { canvas, ctx, undoStack: [] };
    paintDefaultBase(ctx, currentShape, canvas.width, canvas.height);
  });

  // Active canvas touch/pointer events
  activeNailEl.addEventListener('pointerdown', onBrushDown, { passive: false });
  activeNailEl.addEventListener('pointermove', onBrushMove, { passive: false });
  activeNailEl.addEventListener('pointerup',   onBrushUp);
  activeNailEl.addEventListener('pointerleave',onBrushUp);
  activeNailEl.style.touchAction = 'none';

  // Size active canvas to fill its wrapper
  sizeActiveCanvas();
  window.addEventListener('resize', sizeActiveCanvas);

  // Build color swatches
  buildColorSwatches(currentCat);

  setActiveNail('thumb');
}

function sizeActiveCanvas() {
  const wrap = document.querySelector('.active-nail-wrap');
  if (!wrap) return;
  const maxH = Math.min(wrap.clientHeight, 210);
  const h    = Math.max(90, maxH);
  const w    = Math.round(h * (200 / 280)); // maintain 5:7 aspect ratio
  activeNailEl.style.width  = w + 'px';
  activeNailEl.style.height = h + 'px';
}

// ─── Build color swatches for the active category ────────────────────
export function buildColorSwatches(cat) {
  currentCat = cat;
  const container = document.getElementById('color-swatches');
  if (!container) return;
  container.innerHTML = '';

  (COLOR_PALETTE[cat] || []).forEach((hex) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.color = hex;
    btn.style.background = hex;
    btn.title = hex;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      btn.classList.add('selected');
      // Update brush color so painting uses the picked color
      BrushState.color = hex;
      // Update brush color picker UI if present
      const brushPicker = document.getElementById('brush-color-input');
      if (brushPicker) brushPicker.value = hex;
      applyFill(hex);
    });
    container.appendChild(btn);
  });

  // Custom color picker swatch
  const custom = document.createElement('button');
  custom.className = 'swatch swatch-custom';
  custom.title = 'Custom color';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = '#FFFFFF';
  picker.addEventListener('change', () => {
    container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
    custom.classList.add('selected');
    BrushState.color = picker.value;
    const brushPicker = document.getElementById('brush-color-input');
    if (brushPicker) brushPicker.value = picker.value;
    applyFill(picker.value);
  });
  custom.appendChild(picker);
  container.appendChild(custom);
}

// ─── Switch active nail ───────────────────────────────────────────────
export function setActiveNail(finger) {
  if (!nailCanvases[finger]) return;
  activeFingerName = finger;
  syncActiveFromData();

  document.querySelectorAll('.nail-thumb-wrap').forEach((w) => {
    w.classList.toggle('active', w.dataset.finger === finger);
  });
}

function syncActiveFromData() {
  if (!activeCtx) return;
  const W = activeNailEl.width;
  const H = activeNailEl.height;
  activeCtx.clearRect(0, 0, W, H);
  activeCtx.drawImage(nailCanvases[activeFingerName].canvas, 0, 0, W, H);
}

function syncDataFromActive() {
  const { ctx, canvas } = nailCanvases[activeFingerName];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(activeNailEl, 0, 0, canvas.width, canvas.height);
}

// ─── Undo ─────────────────────────────────────────────────────────────
function pushUndo(finger) {
  const { canvas, ctx, undoStack } = nailCanvases[finger || activeFingerName];
  if (undoStack.length >= 20) undoStack.shift();
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export function undo() {
  const { canvas, ctx, undoStack } = nailCanvases[activeFingerName];
  if (!undoStack.length) return;
  ctx.putImageData(undoStack.pop(), 0, 0);
  syncActiveFromData();
}

// ─── Coordinate mapping ───────────────────────────────────────────────
function getCoords(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

function activeTool() {
  return document.querySelector('.tool-tab.active')?.dataset.tool || 'fill';
}

// ─── Brush / eraser drawing ───────────────────────────────────────────
function onBrushDown(e) {
  const tool = activeTool();
  if (tool !== 'brush' && tool !== 'eraser') return;
  e.preventDefault();
  isPainting = true;
  lastPt = getCoords(activeNailEl, e);
  pushUndo();
  _drawDot(lastPt, tool);
}

function onBrushMove(e) {
  if (!isPainting) return;
  const tool = activeTool();
  if (tool !== 'brush' && tool !== 'eraser') return;
  e.preventDefault();
  const pt = getCoords(activeNailEl, e);
  _drawStroke(lastPt, pt, tool);
  lastPt = pt;
}

function onBrushUp() {
  if (!isPainting) return;
  isPainting = false;
  syncDataFromActive();
}

function _withClip(drawFn) {
  activeCtx.save();
  activeCtx.clip(getNailClipPath(currentShape, activeNailEl.width, activeNailEl.height));
  drawFn();
  activeCtx.restore();
}

function _drawDot(pt, tool) {
  _withClip(() => {
    if (tool === 'eraser') {
      activeCtx.globalCompositeOperation = 'destination-out';
      activeCtx.beginPath();
      activeCtx.arc(pt.x, pt.y, BrushState.eraserSize / 2, 0, Math.PI * 2);
      activeCtx.fillStyle = 'rgba(0,0,0,1)';
      activeCtx.fill();
      activeCtx.globalCompositeOperation = 'source-over';
    } else {
      activeCtx.globalAlpha = BrushState.opacity;
      activeCtx.fillStyle = BrushState.color;
      activeCtx.beginPath();
      activeCtx.arc(pt.x, pt.y, BrushState.size / 2, 0, Math.PI * 2);
      activeCtx.fill();
      activeCtx.globalAlpha = 1;
    }
  });
}

function _drawStroke(from, to, tool) {
  _withClip(() => {
    if (tool === 'eraser') {
      activeCtx.globalCompositeOperation = 'destination-out';
      activeCtx.beginPath();
      activeCtx.moveTo(from.x, from.y);
      activeCtx.lineTo(to.x, to.y);
      activeCtx.strokeStyle = 'rgba(0,0,0,1)';
      activeCtx.lineWidth = BrushState.eraserSize;
      activeCtx.lineCap = 'round';
      activeCtx.stroke();
      activeCtx.globalCompositeOperation = 'source-over';
    } else {
      activeCtx.globalAlpha = BrushState.opacity;
      activeCtx.beginPath();
      activeCtx.moveTo(from.x, from.y);
      activeCtx.lineTo(to.x, to.y);
      activeCtx.strokeStyle = BrushState.color;
      activeCtx.lineWidth = BrushState.size;
      activeCtx.lineCap = 'round';
      activeCtx.lineJoin = 'round';
      activeCtx.stroke();
      activeCtx.globalAlpha = 1;
    }
  });
}

// ─── Fill, Gradient, Presets ──────────────────────────────────────────
export function applyFill(color, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  pushUndo(f);
  ctx.save();
  ctx.clip(getNailClipPath(currentShape, canvas.width, canvas.height));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (f === activeFingerName) syncActiveFromData();
}

export function applyGradient(color1, color2, direction, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  const W = canvas.width, H = canvas.height;
  pushUndo(f);

  let grad;
  switch (direction) {
    case 'horizontal':    grad = ctx.createLinearGradient(0, 0, W, 0); break;
    case 'diagonal':      grad = ctx.createLinearGradient(0, 0, W, H); break;
    case 'diagonal-rev':  grad = ctx.createLinearGradient(W, 0, 0, H); break;
    default:              grad = ctx.createLinearGradient(0, 0, 0, H);
  }
  grad.addColorStop(0, color1);
  grad.addColorStop(1, color2);

  ctx.save();
  ctx.clip(getNailClipPath(currentShape, W, H));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  if (f === activeFingerName) syncActiveFromData();
}

export function applyPreset(presetName, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  const W = canvas.width, H = canvas.height;
  pushUndo(f);

  ctx.save();
  ctx.clip(getNailClipPath(currentShape, W, H));
  ctx.clearRect(0, 0, W, H);

  switch (presetName) {
    case 'french':
      ctx.fillStyle = '#F5E6E8'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H * 0.22);
      break;
    case 'ombre-pink': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#E8B4BC'); g.addColorStop(1, '#C4778A');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'red':   ctx.fillStyle = '#A0293C'; ctx.fillRect(0, 0, W, H); break;
    case 'nude':  ctx.fillStyle = '#E8D5B0'; ctx.fillRect(0, 0, W, H); break;
    case 'black': ctx.fillStyle = '#1A1A1A'; ctx.fillRect(0, 0, W, H); break;
    case 'milky': {
      const g2 = ctx.createLinearGradient(0, 0, 0, H);
      g2.addColorStop(0, '#FAFAFA'); g2.addColorStop(1, '#F0E8EC');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
      break;
    }
    default: ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  if (f === activeFingerName) syncActiveFromData();
}

// ─── Apply to all nails ───────────────────────────────────────────────
export function applyToAllNails() {
  const src = nailCanvases[activeFingerName];
  const data = src.ctx.getImageData(0, 0, src.canvas.width, src.canvas.height);
  FINGERS.forEach((f) => {
    if (f === activeFingerName) return;
    const { canvas, ctx, undoStack } = nailCanvases[f];
    if (undoStack.length >= 20) undoStack.shift();
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(data, 0, 0);
  });
}

// ─── Set finish type ──────────────────────────────────────────────────
export function setFinishType(type) { finishType = type; }

// ─── Export design canvases ───────────────────────────────────────────
export function exportDesignImages() {
  return FINGERS.map((f) => ({
    finger:  f,
    dataUrl: nailCanvases[f].canvas.toDataURL('image/png'),
  }));
}

// ─── Build text description of designs ───────────────────────────────
export function buildDesignDescription() {
  const FINISH_DESCS = {
    glossy:  'high-shine glossy gel',
    matte:   'flat matte',
    shimmer: 'pearlescent shimmer',
    chrome:  'reflective chrome mirror',
    glitter: 'sparkling glitter',
  };
  const finishDesc = FINISH_DESCS[finishType] || 'glossy gel';

  const nailDescs = FINGERS.map((f) => {
    const { canvas, ctx } = nailCanvases[f];
    const W = canvas.width, H = canvas.height;
    const base = dominantHex(ctx.getImageData(W * 0.2, H * 0.1, W * 0.6, H * 0.7));
    const tip  = dominantHex(ctx.getImageData(W * 0.2, 0,       W * 0.6, H * 0.18));
    const isFrench = isWhitish(tip) && !isWhitish(base);
    return isFrench ? `${f}:${base}+white-tip` : `${f}:${base}`;
  });

  return `${finishDesc} finish; colors: ${nailDescs.join(', ')}`;
}

function dominantHex(imageData) {
  const d = imageData.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 60) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return '#F5D0BC';
  const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function isWhitish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 215 && g > 215 && b > 215;
}

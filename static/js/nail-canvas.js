/**
 * nail-canvas.js
 * Manages the 5 per-finger flat nail design canvases in Step 3.
 *
 * Exports: initNailCanvases, setActiveNail, applyFill, applyGradient,
 *          startBrush, brushTo, endBrush, applyEraser, applyPreset,
 *          applyToAllNails, undo, exportDesignImages, NAIL_SHAPES
 */

// ─── Nail shape paths (100×100 box, y=0 tip, y=100 cuticle) ──────────
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

// ─── Internal state ───────────────────────────────────────────────────
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
let nailCanvases = {};      // { finger: { canvas, ctx, undoStack } }
let activeNailEl = null;    // large editing <canvas>
let activeCtx = null;
let activeNailCanvas = null; // the data canvas for the active finger
let activeFingerName = 'thumb';
let currentShape = 'oval';
let isPainting = false;
let lastPt = { x: 0, y: 0 };

// current brush settings (updated by wizard.js)
export const BrushState = {
  size: 8,
  opacity: 1.0,
  color: '#C4778A',
  eraserSize: 20,
};

// ─── Build clip path in canvas pixel coords ───────────────────────────
function getNailClipPath(shapeName, W, H) {
  const transform = new DOMMatrix([W / 100, 0, 0, H / 100, 0, 0]);
  const base = new Path2D(NAIL_SHAPES[shapeName] || NAIL_SHAPES.oval);
  const result = new Path2D();
  result.addPath(base, transform);
  return result;
}

// Draw the initial background of a nail canvas (transparent nail shape area)
function paintNailBase(ctx, shapeName, W, H) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill(getNailClipPath(shapeName, W, H));
  ctx.restore();
}

// ─── Public: init all 5 nail canvases ─────────────────────────────────
export function initNailCanvases(shapeName) {
  currentShape = shapeName || 'oval';
  activeNailEl = document.getElementById('active-nail-canvas');
  activeCtx = activeNailEl.getContext('2d');

  FINGERS.forEach((finger) => {
    const canvas = document.querySelector(`.nail-thumb-canvas[data-finger="${finger}"]`);
    const ctx = canvas.getContext('2d');
    nailCanvases[finger] = { canvas, ctx, undoStack: [] };
    paintNailBase(ctx, currentShape, canvas.width, canvas.height);
  });

  // Set up active canvas drawing events
  activeNailEl.addEventListener('pointerdown', onBrushDown, { passive: false });
  activeNailEl.addEventListener('pointermove', onBrushMove, { passive: false });
  activeNailEl.addEventListener('pointerup', onBrushUp);
  activeNailEl.addEventListener('pointerleave', onBrushUp);
  activeNailEl.style.touchAction = 'none';

  setActiveNail('thumb');
}

// ─── Public: update shape (re-render all thumbnails) ──────────────────
export function updateShape(shapeName) {
  currentShape = shapeName;
  FINGERS.forEach((finger) => {
    const { canvas, ctx } = nailCanvases[finger];
    // Re-draw with new clip (existing design will be clipped to new shape)
    // For simplicity, we clear and re-apply base — user's design is reset when shape changes
    paintNailBase(ctx, currentShape, canvas.width, canvas.height);
  });
  syncActiveFromData();
}

// ─── Public: set the active finger for editing ────────────────────────
export function setActiveNail(finger) {
  if (!nailCanvases[finger]) return;
  activeFingerName = finger;
  activeNailCanvas = nailCanvases[finger].canvas;
  syncActiveFromData();

  // Update UI highlights
  document.querySelectorAll('.nail-thumb-wrap').forEach((wrap) => {
    wrap.classList.toggle('active', wrap.dataset.finger === finger);
  });
}

// Copy data canvas → active editing canvas
function syncActiveFromData() {
  if (!activeCtx || !activeNailCanvas) return;
  const W = activeNailEl.width;
  const H = activeNailEl.height;
  activeCtx.clearRect(0, 0, W, H);
  activeCtx.drawImage(activeNailCanvas, 0, 0, W, H);
}

// Copy active editing canvas → data canvas (and thumbnail)
function syncDataFromActive() {
  if (!activeNailCanvas) return;
  const { ctx, canvas } = nailCanvases[activeFingerName];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(activeNailEl, 0, 0, canvas.width, canvas.height);
}

// ─── Undo stack helpers ───────────────────────────────────────────────
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

// ─── Map pointer event coords → canvas coords ─────────────────────────
function getCoords(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

// ─── Brush / eraser pointer handlers ─────────────────────────────────
function currentToolType() {
  const activeTab = document.querySelector('.tool-tab.active');
  return activeTab ? activeTab.dataset.tool : 'fill';
}

function onBrushDown(e) {
  const tool = currentToolType();
  if (tool !== 'brush' && tool !== 'eraser') return;
  e.preventDefault();
  isPainting = true;
  lastPt = getCoords(activeNailEl, e);
  pushUndo();
  const W = activeNailEl.width;
  const H = activeNailEl.height;

  // Draw a dot at the starting point
  activeCtx.save();
  activeCtx.clip(getNailClipPath(currentShape, W, H));
  if (tool === 'eraser') {
    activeCtx.globalCompositeOperation = 'destination-out';
    activeCtx.fillStyle = 'rgba(0,0,0,1)';
    drawCircle(activeCtx, lastPt.x, lastPt.y, BrushState.eraserSize / 2);
  } else {
    activeCtx.globalCompositeOperation = 'source-over';
    activeCtx.globalAlpha = BrushState.opacity;
    activeCtx.fillStyle = BrushState.color;
    drawCircle(activeCtx, lastPt.x, lastPt.y, BrushState.size / 2);
  }
  activeCtx.restore();
}

function onBrushMove(e) {
  if (!isPainting) return;
  const tool = currentToolType();
  if (tool !== 'brush' && tool !== 'eraser') return;
  e.preventDefault();

  const pt = getCoords(activeNailEl, e);
  const W = activeNailEl.width;
  const H = activeNailEl.height;

  activeCtx.save();
  activeCtx.clip(getNailClipPath(currentShape, W, H));

  if (tool === 'eraser') {
    activeCtx.globalCompositeOperation = 'destination-out';
    drawStroke(activeCtx, lastPt, pt, BrushState.eraserSize, 'rgba(0,0,0,1)', 1.0);
  } else {
    activeCtx.globalCompositeOperation = 'source-over';
    drawStroke(activeCtx, lastPt, pt, BrushState.size, BrushState.color, BrushState.opacity);
  }
  activeCtx.restore();

  lastPt = pt;
}

function onBrushUp() {
  if (!isPainting) return;
  isPainting = false;
  syncDataFromActive();
}

function drawCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStroke(ctx, from, to, width, color, opacity) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;
  ctx.stroke();
}

// ─── Public: fill tools ───────────────────────────────────────────────
export function applyFill(color, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  pushUndo(f);
  const W = canvas.width;
  const H = canvas.height;
  ctx.save();
  ctx.clip(getNailClipPath(currentShape, W, H));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  if (f === activeFingerName) syncActiveFromData();
}

export function applyGradient(color1, color2, direction, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  pushUndo(f);
  const W = canvas.width;
  const H = canvas.height;

  let grad;
  if (direction === 'horizontal') {
    grad = ctx.createLinearGradient(0, 0, W, 0);
  } else if (direction === 'diagonal') {
    grad = ctx.createLinearGradient(0, 0, W, H);
  } else {
    grad = ctx.createLinearGradient(0, 0, 0, H); // vertical
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

// ─── Public: preset designs ───────────────────────────────────────────
export function applyPreset(presetName, finger) {
  const f = finger || activeFingerName;
  const { canvas, ctx } = nailCanvases[f];
  const W = canvas.width;
  const H = canvas.height;
  pushUndo(f);

  ctx.save();
  ctx.clip(getNailClipPath(currentShape, W, H));
  ctx.clearRect(0, 0, W, H);

  switch (presetName) {
    case 'french': {
      // Pink base
      ctx.fillStyle = '#F5E6E8';
      ctx.fillRect(0, 0, W, H);
      // White tip (top 20% of nail)
      const tipH = H * 0.20;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, tipH);
      break;
    }
    case 'ombre-pink': {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#E8B4BC');
      grad.addColorStop(1, '#C4778A');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'red': {
      ctx.fillStyle = '#A0293C';
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'nude': {
      ctx.fillStyle = '#E8D5B0';
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'black': {
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'milky': {
      const grad2 = ctx.createLinearGradient(0, 0, 0, H);
      grad2.addColorStop(0, '#FAFAFA');
      grad2.addColorStop(1, '#F0E8EC');
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    default: {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
  if (f === activeFingerName) syncActiveFromData();
}

// ─── Public: apply active nail design to all nails ────────────────────
export function applyToAllNails() {
  const src = nailCanvases[activeFingerName];
  const srcData = src.ctx.getImageData(0, 0, src.canvas.width, src.canvas.height);
  FINGERS.forEach((finger) => {
    if (finger === activeFingerName) return;
    const { canvas, ctx, undoStack } = nailCanvases[finger];
    if (undoStack.length >= 20) undoStack.shift();
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(srcData, 0, 0);
  });
}

// ─── Public: export all nail canvases as data URLs ────────────────────
export function exportDesignImages() {
  return FINGERS.map((finger) => ({
    finger,
    dataUrl: nailCanvases[finger].canvas.toDataURL('image/png'),
  }));
}

// ─── Public: extract a text description of all nail designs ──────────
export function buildDesignDescription() {
  const descriptions = FINGERS.map((finger) => {
    const { canvas, ctx } = nailCanvases[finger];
    const W = canvas.width;
    const H = canvas.height;

    // Sample dominant color of the whole nail
    const allData = ctx.getImageData(W / 4, H / 8, W / 2, (H * 6) / 8);
    const base = getDominantHex(allData);

    // Sample top portion to detect French tip (white tip)
    const tipData = ctx.getImageData(W / 4, H / 16, W / 2, H / 6);
    const tipColor = getDominantHex(tipData);

    const isFrench = isWhitish(tipColor) && !isWhitish(base);
    const suffix = isFrench ? ', white French tip' : '';
    return `${finger} nail: ${base}${suffix}`;
  });

  return descriptions.join('; ');
}

function getDominantHex(imageData) {
  const data = imageData.data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 64) continue; // skip transparent
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (!count) return '#FFFFFF';
  const toHex = (v) => Math.round(v / count).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isWhitish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 220 && g > 220 && b > 220;
}

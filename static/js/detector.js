/**
 * detector.js
 * MediaPipe Hands integration for automatic nail detection.
 * Falls back to hardcoded default positions if detection fails.
 *
 * Exports: initDetector, detectNails, renderOverlays, setupDragCorrection,
 *          getDefaultPositions
 */

import { NAIL_SHAPES } from './nail-canvas.js';

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// MediaPipe landmark indices per finger
// tip, dip (one joint below tip)
const FINGER_LANDMARKS = {
  thumb:  { tip: 4,  dip: 3,  mcp: 1 },
  index:  { tip: 8,  dip: 7,  mcp: 5 },
  middle: { tip: 12, dip: 11, mcp: 9 },
  ring:   { tip: 16, dip: 15, mcp: 13 },
  pinky:  { tip: 20, dip: 19, mcp: 17 },
};

// Finger overlay colors (distinct per finger)
const FINGER_COLORS = {
  thumb:  'rgba(255, 107, 138, 0.75)',
  index:  'rgba(255, 160, 107, 0.75)',
  middle: 'rgba(255, 224, 107, 0.75)',
  ring:   'rgba(107, 255, 158, 0.75)',
  pinky:  'rgba(107, 179, 255, 0.75)',
};

const MEDIAPIPE_VERSION = '0.4.1675469240';

let handsModel = null;
let pendingResolve = null;
let lastNailPositions = []; // cached for re-render

// ─── Init MediaPipe ───────────────────────────────────────────────────
export async function initDetector() {
  if (handsModel) return;

  const Hands = window.Hands;
  if (!Hands) throw new Error('MediaPipe Hands not loaded from CDN.');

  handsModel = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MEDIAPIPE_VERSION}/${file}`,
  });

  handsModel.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  handsModel.onResults((results) => {
    if (pendingResolve) {
      const fn = pendingResolve;
      pendingResolve = null;
      fn(results);
    }
  });

  await handsModel.initialize();
}

// ─── Run detection on an image element ───────────────────────────────
export async function detectNails(imgElement) {
  if (!handsModel) throw new Error('Detector not initialized.');

  const results = await new Promise((resolve) => {
    pendingResolve = resolve;
    handsModel.send({ image: imgElement });
  });

  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    return null; // no hand found
  }

  const landmarks = results.multiHandLandmarks[0];
  const W = imgElement.naturalWidth;
  const H = imgElement.naturalHeight;

  const positions = FINGER_NAMES.map((finger) => {
    const idx = FINGER_LANDMARKS[finger];
    const tip = landmarks[idx.tip];
    const dip = landmarks[idx.dip];

    // Nail center = midpoint between tip and DIP
    const centerX = (tip.x + dip.x) / 2;
    const centerY = (tip.y + dip.y) / 2;

    // Height = euclidean distance tip→dip (in normalized space, relative to image height)
    const dx = (tip.x - dip.x) * W;
    const dy = (tip.y - dip.y) * H;
    const heightNorm = Math.sqrt(dx * dx + dy * dy) / H;

    // Width ≈ 72% of height (typical nail aspect ratio)
    const widthNorm = heightNorm * (finger === 'thumb' ? 0.85 : 0.72);

    // Rotation: angle of the finger axis (tip→dip vector), adjusted so 0° = pointing up
    const rotationDeg = (Math.atan2(tip.y - dip.y, tip.x - dip.x) * 180) / Math.PI + 90;

    return { finger, centerX, centerY, widthNorm, heightNorm, rotationDeg };
  });

  lastNailPositions = positions;
  return positions;
}

// ─── Default positions (fallback when MediaPipe fails) ────────────────
export function getDefaultPositions() {
  // Assumes a typical portrait-orientation hand photo,
  // fingers pointing upward, centered horizontally.
  const defaults = [
    { finger: 'thumb',  centerX: 0.21, centerY: 0.32, widthNorm: 0.065, heightNorm: 0.075, rotationDeg: -28 },
    { finger: 'index',  centerX: 0.38, centerY: 0.22, widthNorm: 0.055, heightNorm: 0.080, rotationDeg: 0 },
    { finger: 'middle', centerX: 0.50, centerY: 0.19, widthNorm: 0.060, heightNorm: 0.085, rotationDeg: 0 },
    { finger: 'ring',   centerX: 0.62, centerY: 0.21, widthNorm: 0.055, heightNorm: 0.080, rotationDeg: 0 },
    { finger: 'pinky',  centerX: 0.74, centerY: 0.26, widthNorm: 0.042, heightNorm: 0.065, rotationDeg: 4 },
  ];
  lastNailPositions = defaults;
  return defaults;
}

// ─── Draw nail overlays on the overlay canvas ─────────────────────────
export function renderOverlays(overlayCanvas, nailPositions, shapeName, lengthMult, sizeMult) {
  const ctx = overlayCanvas.getContext('2d');
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;
  ctx.clearRect(0, 0, W, H);

  nailPositions.forEach((nail) => {
    const cx = nail.centerX * W;
    const cy = nail.centerY * H;
    const nailW = nail.widthNorm * W * sizeMult;
    const nailH = nail.heightNorm * H * lengthMult * sizeMult;
    const color = FINGER_COLORS[nail.finger] || 'rgba(255,255,255,0.6)';

    drawNailOverlay(ctx, shapeName, cx, cy, nailW, nailH, nail.rotationDeg, color);

    // Draw drag handle at center
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.strokeStyle = color.replace('0.75', '1');
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawNailOverlay(ctx, shapeName, cx, cy, nailW, nailH, rotDeg, color) {
  const shapePath = NAIL_SHAPES[shapeName] || NAIL_SHAPES.oval;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);

  // Scale the 100×100 shape to nailW×nailH, centered at origin
  ctx.scale(nailW / 100, nailH / 100);
  ctx.translate(-50, -50);

  const path = new Path2D(shapePath);
  ctx.fillStyle = color;
  ctx.fill(path);

  ctx.strokeStyle = color.replace('0.75', '1');
  ctx.lineWidth = 100 / nailW * 1.5; // keep stroke width ~1.5px in screen space
  ctx.stroke(path);

  ctx.restore();
}

// ─── Manual drag correction ───────────────────────────────────────────
export function setupDragCorrection(overlayCanvas, getNailPositions, onUpdate, getShapeMults) {
  let draggingFinger = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function hitTest(clientX, clientY) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const mx = (clientX - rect.left) * scaleX;
    const my = (clientY - rect.top) * scaleY;
    const W = overlayCanvas.width;
    const H = overlayCanvas.height;
    const positions = getNailPositions();

    let closest = null;
    let closestDist = 30; // px hit radius

    positions.forEach((nail) => {
      const cx = nail.centerX * W;
      const cy = nail.centerY * H;
      const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
      if (dist < closestDist) {
        closestDist = dist;
        closest = nail;
        dragOffsetX = mx - cx;
        dragOffsetY = my - cy;
      }
    });
    return closest;
  }

  overlayCanvas.addEventListener('pointerdown', (e) => {
    const nail = hitTest(e.clientX, e.clientY);
    if (nail) {
      draggingFinger = nail.finger;
      overlayCanvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  overlayCanvas.addEventListener('pointermove', (e) => {
    if (!draggingFinger) return;
    e.preventDefault();
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const W = overlayCanvas.width;
    const H = overlayCanvas.height;

    const positions = getNailPositions();
    const nail = positions.find((n) => n.finger === draggingFinger);
    if (nail) {
      nail.centerX = Math.max(0, Math.min(1, (mx - dragOffsetX) / W));
      nail.centerY = Math.max(0, Math.min(1, (my - dragOffsetY) / H));
      const { shapeName, lengthMult, sizeMult } = getShapeMults();
      renderOverlays(overlayCanvas, positions, shapeName, lengthMult, sizeMult);
      onUpdate(positions);
    }
  });

  overlayCanvas.addEventListener('pointerup', () => {
    draggingFinger = null;
  });

  overlayCanvas.style.touchAction = 'none';
}

// ─── Sync canvas size to match the displayed photo ───────────────────
export function syncCanvasToPhoto(photo, canvas) {
  const rect = photo.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
}

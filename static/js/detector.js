/**
 * detector.js — MediaPipe Hands detection + overlay rendering.
 *
 * KEY FIX: widthNorm is now stored as a fraction of image WIDTH,
 * so nailW = widthNorm * W gives correct pixel width regardless of
 * photo aspect ratio. Previously it was a fraction of height, causing
 * nails to appear far too narrow in portrait photos.
 */

import { NAIL_SHAPES } from './nail-canvas.js';

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const FINGER_LANDMARKS = {
  thumb:  { tip: 4,  dip: 3  },
  index:  { tip: 8,  dip: 7  },
  middle: { tip: 12, dip: 11 },
  ring:   { tip: 16, dip: 15 },
  pinky:  { tip: 20, dip: 19 },
};

// Overlay colors — rose on the light theme
const OVERLAY_FILL   = 'rgba(196, 119, 138, 0.18)';
const OVERLAY_STROKE = 'rgba(139, 74, 90, 0.85)';
const HANDLE_FILL    = '#C4778A';
const HANDLE_SELECTED_FILL = '#8B4A5A';

const MEDIAPIPE_VERSION = '0.4.1675469240';

let handsModel = null;
let pendingResolve = null;

// ─── Init ─────────────────────────────────────────────────────────────
export async function initDetector() {
  if (handsModel) return;
  const Hands = window.Hands;
  if (!Hands) throw new Error('MediaPipe Hands CDN script not loaded.');

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

// ─── Detect nails in a static image ──────────────────────────────────
export async function detectNails(imgElement) {
  if (!handsModel) throw new Error('Detector not initialized.');

  const results = await new Promise((resolve) => {
    pendingResolve = resolve;
    handsModel.send({ image: imgElement });
  });

  if (!results.multiHandLandmarks?.length) return null;

  const landmarks = results.multiHandLandmarks[0];
  const natW = imgElement.naturalWidth;
  const natH = imgElement.naturalHeight;

  return FINGER_NAMES.map((finger) => {
    const idx = FINGER_LANDMARKS[finger];
    const tip = landmarks[idx.tip];
    const dip = landmarks[idx.dip];

    // Nail center = midpoint between fingertip and DIP joint
    const centerX = (tip.x + dip.x) / 2;
    const centerY = (tip.y + dip.y) / 2;

    // Pixel distance tip → DIP
    const dx = (tip.x - dip.x) * natW;
    const dy = (tip.y - dip.y) * natH;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);

    // heightNorm = fraction of image HEIGHT
    const heightNorm = pixelDist / natH;

    // WIDTH FIX: nail pixel width = pixelDist * aspect_ratio
    // widthNorm must be a fraction of image WIDTH so nailW = widthNorm * W
    const aspect = finger === 'thumb' ? 0.85 : 0.72;
    const widthNorm = (pixelDist * aspect) / natW;

    // Rotation: finger axis angle, 0° = pointing straight up
    const rotationDeg = (Math.atan2(tip.y - dip.y, tip.x - dip.x) * 180) / Math.PI + 90;

    return { finger, centerX, centerY, widthNorm, heightNorm, rotationDeg };
  });
}

// ─── Default nail positions ───────────────────────────────────────────
// For a portrait-orientation photo (1080×1920 equivalent).
// widthNorm = fraction of image width, heightNorm = fraction of image height.
export function getDefaultPositions() {
  return [
    { finger: 'thumb',  centerX: 0.22, centerY: 0.32, widthNorm: 0.074, heightNorm: 0.080, rotationDeg: -28 },
    { finger: 'index',  centerX: 0.38, centerY: 0.22, widthNorm: 0.068, heightNorm: 0.082, rotationDeg: 0   },
    { finger: 'middle', centerX: 0.50, centerY: 0.19, widthNorm: 0.074, heightNorm: 0.090, rotationDeg: 0   },
    { finger: 'ring',   centerX: 0.62, centerY: 0.21, widthNorm: 0.068, heightNorm: 0.082, rotationDeg: 0   },
    { finger: 'pinky',  centerX: 0.74, centerY: 0.27, widthNorm: 0.054, heightNorm: 0.066, rotationDeg: 4   },
  ];
}

// ─── Hit-test: find which nail handle the pointer is near ─────────────
export function hitTestNail(clientX, clientY, overlayCanvas, nailPositions) {
  const rect = overlayCanvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  const scaleX = overlayCanvas.width  / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  const mx = (clientX - rect.left) * scaleX;
  const my = (clientY - rect.top)  * scaleY;
  const W  = overlayCanvas.width;
  const H  = overlayCanvas.height;

  let best = null;
  let bestDist = 40; // hit-test radius in canvas pixels

  nailPositions.forEach((nail) => {
    const cx = nail.centerX * W;
    const cy = nail.centerY * H;
    const d  = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
    if (d < bestDist) { bestDist = d; best = nail; }
  });
  return best;
}

// ─── Render overlays on the canvas ───────────────────────────────────
export function renderOverlays(overlayCanvas, nailPositions, shapeName, lengthMult, sizeMult, selectedNail) {
  const ctx = overlayCanvas.getContext('2d');
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;
  ctx.clearRect(0, 0, W, H);

  nailPositions.forEach((nail) => {
    const cx    = nail.centerX  * W;
    const cy    = nail.centerY  * H;
    const nailW = nail.widthNorm  * W * sizeMult;
    const nailH = nail.heightNorm * H * lengthMult * sizeMult;
    const isSelected = selectedNail && selectedNail === nail;

    // Draw nail shape
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((nail.rotationDeg * Math.PI) / 180);
    ctx.scale(nailW / 100, nailH / 100);
    ctx.translate(-50, -50);

    const path = new Path2D(NAIL_SHAPES[shapeName] || NAIL_SHAPES.oval);
    ctx.fillStyle = isSelected ? 'rgba(139,74,90,0.22)' : OVERLAY_FILL;
    ctx.fill(path);
    ctx.strokeStyle = isSelected ? 'rgba(139,74,90,1)' : OVERLAY_STROKE;
    ctx.lineWidth = (100 / nailW) * (isSelected ? 2 : 1.5);
    ctx.stroke(path);
    ctx.restore();

    // Draw tiny drag handle dot — small so it doesn't hide the nail
    const dotR = Math.max(2.5, Math.min(4, nailW * 0.06));
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? HANDLE_SELECTED_FILL : HANDLE_FILL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

// ─── Sync canvas intrinsic size to displayed photo dimensions ─────────
export function syncCanvasToPhoto(photo, canvas) {
  // photo.getBoundingClientRect() gives the rendered CSS size
  const rect = photo.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width  = Math.round(rect.width);
  canvas.height = Math.round(rect.height);
  canvas.style.width  = rect.width  + 'px';
  canvas.style.height = rect.height + 'px';
}

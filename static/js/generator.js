/**
 * generator.js
 * Builds the nail mask, collects design descriptions,
 * POSTs to /api/generate, and renders the result in Step 4.
 *
 * Exports: submitGeneration
 */

import { NAIL_SHAPES, exportDesignImages, buildDesignDescription } from './nail-canvas.js';

// ─── Build the mask canvas (white nails on black background) ──────────
export function buildMaskCanvas(handImg, nailPositions, shapeName, lengthMult, sizeMult) {
  const W = handImg.naturalWidth;
  const H = handImg.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Black background = "do not touch"
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // White = "apply nail design here"
  ctx.fillStyle = '#ffffff';

  const shapePath = NAIL_SHAPES[shapeName] || NAIL_SHAPES.oval;

  nailPositions.forEach((nail) => {
    const cx = nail.centerX * W;
    const cy = nail.centerY * H;
    const nailW = nail.widthNorm * W * sizeMult;
    const nailH = nail.heightNorm * H * lengthMult * sizeMult;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((nail.rotationDeg * Math.PI) / 180);
    ctx.scale(nailW / 100, nailH / 100);
    ctx.translate(-50, -50);
    ctx.fill(new Path2D(shapePath));
    ctx.restore();
  });

  return canvas;
}

// ─── Convert a canvas/img to base64 string (no prefix) ───────────────
function canvasToBase64(canvas) {
  return canvas.toDataURL('image/png').split(',')[1];
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Main generation entry point ──────────────────────────────────────
export async function submitGeneration(AppState) {
  const {
    handPhotoBlob,
    handPhotoImg,
    nailPositions,
    nailShape,
    nailLength,
    sizeMultiplier,
  } = AppState;

  const LENGTH_MULTS = { short: 0.70, medium: 1.0, long: 1.35 };
  const lengthMult = LENGTH_MULTS[nailLength] || 1.0;

  // Build mask
  const maskCanvas = buildMaskCanvas(
    handPhotoImg,
    nailPositions,
    nailShape,
    lengthMult,
    sizeMultiplier,
  );

  // Collect design description text
  const designDescription = buildDesignDescription();

  // Convert images to base64
  const [handB64, maskB64] = await Promise.all([
    blobToBase64(handPhotoBlob),
    Promise.resolve(canvasToBase64(maskCanvas)),
  ]);

  const payload = {
    handPhotoB64: handB64,
    maskB64,
    designDescription,
    shape: nailShape,
    length: nailLength,
  };

  const resp = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let msg = `Server error (${resp.status})`;
    try {
      const data = await resp.json();
      if (data.error) msg = data.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'Generation failed.');
  return data.imageB64;
}

// ─── Render result in Step 4 ──────────────────────────────────────────
export function renderResult(originalBlob, generatedB64) {
  const loadingEl = document.getElementById('result-loading');
  const successEl = document.getElementById('result-success');
  const errorEl   = document.getElementById('result-error');

  loadingEl.style.display = 'none';
  errorEl.hidden = true;
  successEl.hidden = false;

  // Original photo
  const originalUrl = URL.createObjectURL(originalBlob);
  document.getElementById('result-original').src = originalUrl;

  // Generated photo (base64)
  const generatedUrl = `data:image/png;base64,${generatedB64}`;
  document.getElementById('result-generated').src = generatedUrl;

  // Download link
  const dlBtn = document.getElementById('download-btn');
  dlBtn.href = generatedUrl;
  dlBtn.download = 'nail-preview.png';
}

export function renderError(message) {
  const loadingEl = document.getElementById('result-loading');
  const successEl = document.getElementById('result-success');
  const errorEl   = document.getElementById('result-error');

  loadingEl.style.display = 'none';
  successEl.hidden = true;
  errorEl.hidden = false;

  document.getElementById('error-message').textContent =
    message || 'Something went wrong. Please try again.';
}

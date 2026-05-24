/**
 * wizard.js
 * Main app orchestrator. Manages step navigation, global AppState,
 * photo upload (with EXIF correction), and wires up all UI events.
 */

import {
  initNailCanvases,
  setActiveNail,
  applyFill,
  applyGradient,
  applyPreset,
  applyToAllNails,
  undo,
  updateShape,
  BrushState,
} from './nail-canvas.js';

import {
  initDetector,
  detectNails,
  getDefaultPositions,
  renderOverlays,
  setupDragCorrection,
  syncCanvasToPhoto,
} from './detector.js';

import {
  submitGeneration,
  renderResult,
  renderError,
} from './generator.js';

// ─── Global App State ─────────────────────────────────────────────────
export const AppState = {
  step: 1,
  handPhotoBlob: null,   // EXIF-corrected JPEG blob
  handPhotoImg: null,    // HTMLImageElement
  nailPositions: [],     // [{ finger, centerX, centerY, widthNorm, heightNorm, rotationDeg }, ...]
  nailShape: 'oval',
  nailLength: 'medium',
  sizeMultiplier: 1.0,
  nailCanvases: null,
  activeNailFinger: 'thumb',
};

const LENGTH_MULTS = { short: 0.70, medium: 1.0, long: 1.35 };

// ─── Step navigation ──────────────────────────────────────────────────
function goToStep(n) {
  document.querySelector(`.step.active`)?.classList.remove('active');
  document.getElementById(`step-${n}`)?.classList.add('active');
  AppState.step = n;

  // Update progress dots
  document.querySelectorAll('.progress-dot').forEach((dot) => {
    const s = parseInt(dot.dataset.step);
    dot.classList.remove('active', 'done');
    if (s === n) dot.classList.add('active');
    else if (s < n) dot.classList.add('done');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (n === 2) onEnterStep2();
  if (n === 3) onEnterStep3();
}

// ─── Step 2: auto-detect nails ────────────────────────────────────────
async function onEnterStep2() {
  const photo = document.getElementById('detection-photo');
  const overlay = document.getElementById('overlay-canvas');
  const status = document.getElementById('detect-status');

  photo.src = URL.createObjectURL(AppState.handPhotoBlob);

  photo.onload = async () => {
    syncCanvasToPhoto(photo, overlay);

    status.classList.remove('hidden');
    status.innerHTML = '<span class="detect-spinner"></span> Detecting nails&hellip;';

    try {
      await initDetector();
      const positions = await detectNails(AppState.handPhotoImg);
      AppState.nailPositions = positions || getDefaultPositions();
    } catch (err) {
      console.warn('MediaPipe detection failed, using defaults:', err);
      AppState.nailPositions = getDefaultPositions();
    }

    status.classList.add('hidden');
    redrawOverlays();
    setupDragCorrection(
      overlay,
      () => AppState.nailPositions,
      (updated) => { AppState.nailPositions = updated; },
      () => ({
        shapeName: AppState.nailShape,
        lengthMult: LENGTH_MULTS[AppState.nailLength] || 1.0,
        sizeMult: AppState.sizeMultiplier,
      }),
    );
  };
}

function redrawOverlays() {
  const overlay = document.getElementById('overlay-canvas');
  renderOverlays(
    overlay,
    AppState.nailPositions,
    AppState.nailShape,
    LENGTH_MULTS[AppState.nailLength] || 1.0,
    AppState.sizeMultiplier,
  );
}

// ─── Step 3: init design studio ───────────────────────────────────────
let step3Initialized = false;

function onEnterStep3() {
  if (!step3Initialized) {
    initNailCanvases(AppState.nailShape);
    step3Initialized = true;
  }
  // If user goes back to step 2 and changes shape, update overlays but keep designs
}

// ─── EXIF-aware photo upload ──────────────────────────────────────────
function loadPhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Draw to offscreen canvas so browser auto-applies EXIF rotation
      const offscreen = document.createElement('canvas');
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(img, 0, 0);

      offscreen.toBlob((blob) => {
        AppState.handPhotoBlob = blob;

        // Create corrected image element for MediaPipe
        const correctedImg = new Image();
        correctedImg.onload = () => { AppState.handPhotoImg = correctedImg; };
        correctedImg.src = URL.createObjectURL(blob);

        // Show preview
        const preview = document.getElementById('upload-preview');
        preview.src = URL.createObjectURL(blob);
        document.getElementById('upload-zone').hidden = true;
        document.getElementById('preview-wrap').hidden = false;
        document.getElementById('step1-next').disabled = false;
      }, 'image/jpeg', 0.92);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Wire up all events ───────────────────────────────────────────────
function initApp() {
  // ── Step 1: Upload ────────────────────────────────────────
  const uploadZone = document.getElementById('upload-zone');
  const photoInput = document.getElementById('photo-input');

  uploadZone.addEventListener('click', () => photoInput.click());
  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') photoInput.click();
  });

  photoInput.addEventListener('change', () => {
    if (photoInput.files[0]) loadPhotoFile(photoInput.files[0]);
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadPhotoFile(file);
  });

  document.getElementById('change-photo-btn').addEventListener('click', () => {
    document.getElementById('upload-zone').hidden = false;
    document.getElementById('preview-wrap').hidden = true;
    document.getElementById('step1-next').disabled = true;
    AppState.handPhotoBlob = null;
    AppState.handPhotoImg = null;
    photoInput.value = '';
  });

  document.getElementById('step1-next').addEventListener('click', () => goToStep(2));

  // ── Step 2: Detect & Style ────────────────────────────────
  document.getElementById('step2-back').addEventListener('click', () => goToStep(1));
  document.getElementById('step2-next').addEventListener('click', () => goToStep(3));

  document.getElementById('redetect-btn').addEventListener('click', async () => {
    const status = document.getElementById('detect-status');
    status.classList.remove('hidden');
    status.innerHTML = '<span class="detect-spinner"></span> Re-detecting&hellip;';
    try {
      await initDetector();
      const positions = await detectNails(AppState.handPhotoImg);
      AppState.nailPositions = positions || getDefaultPositions();
    } catch {
      AppState.nailPositions = getDefaultPositions();
    }
    status.classList.add('hidden');
    redrawOverlays();
  });

  // Shape buttons
  document.querySelectorAll('.shape-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.nailShape = btn.dataset.shape;
      redrawOverlays();
    });
  });

  // Length buttons
  document.querySelectorAll('.length-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.length-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.nailLength = btn.dataset.length;
      redrawOverlays();
    });
  });

  // Size slider
  const sizeSlider = document.getElementById('size-slider');
  sizeSlider.addEventListener('input', () => {
    AppState.sizeMultiplier = sizeSlider.value / 100;
    document.getElementById('size-val').textContent = `${sizeSlider.value}%`;
    redrawOverlays();
  });

  // ── Step 3: Design Studio ─────────────────────────────────
  document.getElementById('step3-back').addEventListener('click', () => goToStep(2));

  // Nail thumbnail selection
  document.querySelectorAll('.nail-thumb-wrap').forEach((wrap) => {
    wrap.addEventListener('click', () => setActiveNail(wrap.dataset.finger));
  });

  // Tool tabs
  document.querySelectorAll('.tool-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tool-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tool-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`panel-${tab.dataset.tool}`);
      if (panel) panel.classList.add('active');
    });
  });

  // Fill: color swatches
  document.querySelectorAll('.swatch:not(.custom-swatch)').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      applyFill(swatch.dataset.color);
    });
  });

  // Fill: custom color picker
  const customColorInput = document.getElementById('custom-color-input');
  customColorInput.addEventListener('change', () => {
    document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
    document.getElementById('custom-swatch').classList.add('selected');
    applyFill(customColorInput.value);
  });

  // Gradient direction buttons
  document.querySelectorAll('.dir-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dir-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Apply gradient
  document.getElementById('apply-gradient-btn').addEventListener('click', () => {
    const c1 = document.getElementById('grad-color1').value;
    const c2 = document.getElementById('grad-color2').value;
    const dir = document.querySelector('.dir-btn.active')?.dataset.dir || 'vertical';
    applyGradient(c1, c2, dir);
  });

  // Brush controls
  const brushSizeSlider = document.getElementById('brush-size');
  brushSizeSlider.addEventListener('input', () => {
    BrushState.size = parseInt(brushSizeSlider.value);
    document.getElementById('brush-size-val').textContent = `${brushSizeSlider.value}px`;
  });

  const brushOpacitySlider = document.getElementById('brush-opacity');
  brushOpacitySlider.addEventListener('input', () => {
    BrushState.opacity = brushOpacitySlider.value / 100;
    document.getElementById('brush-opacity-val').textContent = `${brushOpacitySlider.value}%`;
  });

  document.getElementById('brush-color-input').addEventListener('input', (e) => {
    BrushState.color = e.target.value;
  });

  // Eraser size
  const eraserSizeSlider = document.getElementById('eraser-size');
  eraserSizeSlider.addEventListener('input', () => {
    BrushState.eraserSize = parseInt(eraserSizeSlider.value);
    document.getElementById('eraser-size-val').textContent = `${eraserSizeSlider.value}px`;
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  // Apply to all / undo
  document.getElementById('apply-all-btn').addEventListener('click', () => applyToAllNails());
  document.getElementById('undo-btn').addEventListener('click', () => undo());

  // Generate
  document.getElementById('generate-btn').addEventListener('click', async () => {
    goToStep(4);
    showLoading();
    try {
      const generatedB64 = await submitGeneration(AppState);
      renderResult(AppState.handPhotoBlob, generatedB64);
    } catch (err) {
      console.error('Generation failed:', err);
      renderError(err.message);
    }
  });

  // ── Step 4: Result ────────────────────────────────────────
  document.getElementById('try-again-btn').addEventListener('click', async () => {
    showLoading();
    try {
      const generatedB64 = await submitGeneration(AppState);
      renderResult(AppState.handPhotoBlob, generatedB64);
    } catch (err) {
      renderError(err.message);
    }
  });

  document.getElementById('retry-btn').addEventListener('click', async () => {
    showLoading();
    try {
      const generatedB64 = await submitGeneration(AppState);
      renderResult(AppState.handPhotoBlob, generatedB64);
    } catch (err) {
      renderError(err.message);
    }
  });

  document.getElementById('start-over-btn').addEventListener('click', () => {
    goToStep(1);
    resetApp();
  });

  document.getElementById('error-start-over-btn').addEventListener('click', () => {
    goToStep(1);
    resetApp();
  });
}

function showLoading() {
  document.getElementById('result-loading').style.display = '';
  document.getElementById('result-success').hidden = true;
  document.getElementById('result-error').hidden = true;
}

function resetApp() {
  AppState.handPhotoBlob = null;
  AppState.handPhotoImg = null;
  AppState.nailPositions = [];
  AppState.nailShape = 'oval';
  AppState.nailLength = 'medium';
  AppState.sizeMultiplier = 1.0;

  // Reset step 1 UI
  const photoInput = document.getElementById('photo-input');
  if (photoInput) photoInput.value = '';
  document.getElementById('upload-zone').hidden = false;
  document.getElementById('preview-wrap').hidden = true;
  document.getElementById('step1-next').disabled = true;
}

// ─── Bootstrap ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);

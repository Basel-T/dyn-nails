/**
 * wizard.js
 * Main app orchestrator — step nav, global AppState, zoom/pan/drag,
 * EXIF-corrected photo upload, and all UI event wiring.
 */

import {
  initNailCanvases,
  setActiveNail,
  applyFill,
  applyGradient,
  applyPreset,
  applyToAllNails,
  undo,
  BrushState,
  setFinishType,
  buildColorSwatches,
} from './nail-canvas.js';

import {
  initDetector,
  detectNails,
  getDefaultPositions,
  renderOverlays,
  hitTestNail,
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
  handPhotoImg:  null,   // HTMLImageElement (corrected)
  nailPositions: [],     // [{finger,centerX,centerY,widthNorm,heightNorm,rotationDeg}]
  nailShape:     'oval',
  nailLength:    'medium',
  sizeMultiplier: 1.0,
  activeNailFinger: 'thumb',
};

const LENGTH_MULTS = { short: 0.70, medium: 1.0, long: 1.35 };

// ─── Step navigation ──────────────────────────────────────────────────
function goToStep(n) {
  document.querySelector('.step.active')?.classList.remove('active');
  document.getElementById(`step-${n}`)?.classList.add('active');
  AppState.step = n;

  document.querySelectorAll('.progress-dot').forEach((dot) => {
    const s = parseInt(dot.dataset.step);
    dot.classList.remove('active', 'done');
    if (s === n)      dot.classList.add('active');
    else if (s < n)   dot.classList.add('done');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (n === 2) onEnterStep2();
  if (n === 3) onEnterStep3();
}

// ─── Zoom / Pan state ─────────────────────────────────────────────────
let zoom  = 1.0;
let panX  = 0;
let panY  = 0;

// Pinch-to-zoom
let isPinching       = false;
let pinchStartDist   = 0;
let pinchStartZoom   = 1;
let pinchStartPanX   = 0;
let pinchStartPanY   = 0;
let pinchStartMidX   = 0;
let pinchStartMidY   = 0;

// Touch pan
let isPanning          = false;
let panTouchStartX     = 0;
let panTouchStartY     = 0;
let panTouchStartPanX  = 0;
let panTouchStartPanY  = 0;

// Touch nail drag
let isDraggingNail = false;
let draggedNail    = null;

// Rotation slider state (module-level so resetApp can zero it)
let prevRotVal = 0;

// Mouse state
let isMouseDown        = false;
let mouseNail          = null;
let mouseStartPanX     = 0;
let mouseStartPanY     = 0;
let mouseStartClientX  = 0;
let mouseStartClientY  = 0;

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function applyTransform() {
  const scene = document.getElementById('photo-scene');
  if (scene) scene.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  const txt = document.getElementById('zoom-level-text');
  if (txt) txt.textContent = `${Math.round(zoom * 100)}%`;
}

function clampPan() {
  const vp    = document.getElementById('photo-viewport');
  const scene = document.getElementById('photo-scene');
  if (!vp || !scene) return;
  const vW = vp.clientWidth;
  const vH = vp.clientHeight;
  const sW = scene.offsetWidth  * zoom;
  const sH = scene.offsetHeight * zoom;
  panX = Math.max(Math.min(vW - sW, 0), Math.min(0, panX));
  panY = Math.max(Math.min(vH - sH, 0), Math.min(0, panY));
}

function resetZoom() {
  zoom = 1.0; panX = 0; panY = 0;
  applyTransform();
}

// ─── Step 2: nail detection ───────────────────────────────────────────
async function onEnterStep2() {
  const photo   = document.getElementById('detection-photo');
  const overlay = document.getElementById('overlay-canvas');
  const status  = document.getElementById('detect-status');

  photo.src = URL.createObjectURL(AppState.handPhotoBlob);

  photo.onload = async () => {
    syncCanvasToPhoto(photo, overlay);
    resetZoom();

    status.classList.remove('hidden');

    try {
      await initDetector();
      const positions = await detectNails(AppState.handPhotoImg);
      AppState.nailPositions = positions || getDefaultPositions();
    } catch (err) {
      console.warn('Detection failed, using defaults:', err);
      AppState.nailPositions = getDefaultPositions();
    }

    status.classList.add('hidden');
    redrawOverlays();
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

// ─── Step 3: design studio ────────────────────────────────────────────
let step3Initialized = false;

function onEnterStep3() {
  if (!step3Initialized) {
    initNailCanvases(AppState.nailShape);
    step3Initialized = true;
  }
}

// ─── EXIF-aware photo upload ──────────────────────────────────────────
function loadPhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Draw onto offscreen canvas so browser strips EXIF rotation
      const off = document.createElement('canvas');
      off.width  = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext('2d').drawImage(img, 0, 0);

      off.toBlob((blob) => {
        AppState.handPhotoBlob = blob;

        const corrected = new Image();
        corrected.onload = () => { AppState.handPhotoImg = corrected; };
        corrected.src = URL.createObjectURL(blob);

        document.getElementById('upload-preview').src = URL.createObjectURL(blob);
        document.getElementById('upload-options').hidden  = true;
        document.getElementById('preview-wrap').hidden    = false;
        document.getElementById('step1-next').disabled    = false;
      }, 'image/jpeg', 0.92);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Wire up all events ───────────────────────────────────────────────
function initApp() {

  // ── Step 1: Upload ────────────────────────────────────────
  document.getElementById('gallery-btn').addEventListener('click', () =>
    document.getElementById('gallery-input').click());

  document.getElementById('camera-btn').addEventListener('click', () =>
    document.getElementById('camera-input').click());

  ['gallery-input', 'camera-input'].forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      if (e.target.files[0]) loadPhotoFile(e.target.files[0]);
    });
  });

  document.getElementById('change-photo-btn').addEventListener('click', () => {
    document.getElementById('upload-options').hidden  = false;
    document.getElementById('preview-wrap').hidden    = true;
    document.getElementById('step1-next').disabled    = true;
    AppState.handPhotoBlob = null;
    AppState.handPhotoImg  = null;
    document.getElementById('gallery-input').value = '';
    document.getElementById('camera-input').value  = '';
  });

  document.getElementById('step1-next').addEventListener('click', () => goToStep(2));

  // ── Step 2: Zoom / Pan / Drag ─────────────────────────────
  const viewport = document.getElementById('photo-viewport');
  const overlay  = document.getElementById('overlay-canvas');

  // ·· Touch events ·············································
  viewport.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const vRect = viewport.getBoundingClientRect();

    if (e.touches.length === 2) {
      // Start pinch
      isPinching     = true;
      isDraggingNail = false;
      isPanning      = false;
      pinchStartDist  = getTouchDist(e.touches);
      pinchStartZoom  = zoom;
      pinchStartPanX  = panX;
      pinchStartPanY  = panY;
      pinchStartMidX  = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vRect.left;
      pinchStartMidY  = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vRect.top;

    } else if (e.touches.length === 1) {
      const t    = e.touches[0];
      const nail = hitTestNail(t.clientX, t.clientY, overlay, AppState.nailPositions);
      if (nail) {
        isDraggingNail = true;
        draggedNail    = nail;
        isPanning      = false;
      } else {
        isPanning          = true;
        isDraggingNail     = false;
        panTouchStartX     = t.clientX;
        panTouchStartY     = t.clientY;
        panTouchStartPanX  = panX;
        panTouchStartPanY  = panY;
      }
    }
  }, { passive: false });

  viewport.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length === 2 && isPinching) {
      const vRect       = viewport.getBoundingClientRect();
      const currentMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vRect.left;
      const currentMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vRect.top;
      const currentDist = getTouchDist(e.touches);
      const newZoom     = Math.max(1.0, Math.min(5.0, pinchStartZoom * currentDist / pinchStartDist));

      // Keep scene point that was under pinch-start midpoint under currentMid
      const sceneX = (pinchStartMidX - pinchStartPanX) / pinchStartZoom;
      const sceneY = (pinchStartMidY - pinchStartPanY) / pinchStartZoom;
      panX = currentMidX - sceneX * newZoom;
      panY = currentMidY - sceneY * newZoom;
      zoom = newZoom;
      clampPan();
      applyTransform();

    } else if (e.touches.length === 1 && isDraggingNail && draggedNail) {
      const t    = e.touches[0];
      const rect = overlay.getBoundingClientRect();
      if (rect.width > 0) {
        draggedNail.centerX = Math.max(0, Math.min(1, (t.clientX - rect.left)  / rect.width));
        draggedNail.centerY = Math.max(0, Math.min(1, (t.clientY - rect.top)   / rect.height));
        redrawOverlays();
      }

    } else if (e.touches.length === 1 && isPanning) {
      const t = e.touches[0];
      panX = panTouchStartPanX + (t.clientX - panTouchStartX);
      panY = panTouchStartPanY + (t.clientY - panTouchStartY);
      clampPan();
      applyTransform();
    }
  }, { passive: false });

  viewport.addEventListener('touchend',   () => {
    isPinching = false; isDraggingNail = false; draggedNail = null; isPanning = false;
  });
  viewport.addEventListener('touchcancel', () => {
    isPinching = false; isDraggingNail = false; draggedNail = null; isPanning = false;
  });

  // ·· Mouse events ·············································
  viewport.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const nail = hitTestNail(e.clientX, e.clientY, overlay, AppState.nailPositions);
    isMouseDown      = true;
    mouseNail        = nail;
    mouseStartClientX = e.clientX;
    mouseStartClientY = e.clientY;
    mouseStartPanX    = panX;
    mouseStartPanY    = panY;
    viewport.style.cursor = nail ? 'move' : 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    if (mouseNail) {
      const rect = overlay.getBoundingClientRect();
      if (rect.width > 0) {
        mouseNail.centerX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        mouseNail.centerY = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
        redrawOverlays();
      }
    } else {
      panX = mouseStartPanX + (e.clientX - mouseStartClientX);
      panY = mouseStartPanY + (e.clientY - mouseStartClientY);
      clampPan();
      applyTransform();
    }
  });

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
    mouseNail   = null;
    const vp = document.getElementById('photo-viewport');
    if (vp) vp.style.cursor = '';
  });

  // Zoom buttons
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    zoom = Math.min(5.0, zoom + 0.5);
    clampPan();
    applyTransform();
  });
  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    zoom = Math.max(1.0, zoom - 0.5);
    if (zoom <= 1.0) { zoom = 1.0; panX = 0; panY = 0; }
    clampPan();
    applyTransform();
  });
  document.getElementById('zoom-reset-btn').addEventListener('click', resetZoom);

  // Re-detect
  document.getElementById('redetect-btn').addEventListener('click', async () => {
    const status = document.getElementById('detect-status');
    status.classList.remove('hidden');
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
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.nailShape = btn.dataset.shape;
      redrawOverlays();
    });
  });

  // Length slider  (1=Short, 2=Medium, 3=Long)
  const lengthSlider = document.getElementById('length-slider');
  const LENGTH_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' };
  lengthSlider.addEventListener('input', () => {
    const labels = ['short', 'medium', 'long'];
    AppState.nailLength = labels[parseInt(lengthSlider.value) - 1] || 'medium';
    document.getElementById('length-val').textContent = LENGTH_LABELS[AppState.nailLength];
    redrawOverlays();
  });

  // Width / size slider
  const sizeSlider = document.getElementById('size-slider');
  sizeSlider.addEventListener('input', () => {
    AppState.sizeMultiplier = sizeSlider.value / 100;
    document.getElementById('size-val').textContent = `${sizeSlider.value}%`;
    redrawOverlays();
  });

  // Rotation slider — applies a global delta to all nail rotations
  // (module-scoped prevRotVal allows resetApp to zero it out)
  const rotationSlider = document.getElementById('rotation-slider');
  rotationSlider.addEventListener('input', () => {
    const val   = parseInt(rotationSlider.value);
    const delta = val - prevRotVal;
    prevRotVal  = val;
    AppState.nailPositions.forEach(nail => { nail.rotationDeg += delta; });
    document.getElementById('rotation-val').textContent = `${val >= 0 ? '+' : ''}${val}°`;
    redrawOverlays();
  });

  document.getElementById('step2-back').addEventListener('click', () => goToStep(1));
  document.getElementById('step2-next').addEventListener('click', () => goToStep(3));

  // ── Step 3: Design Studio ─────────────────────────────────
  // Nail thumbnails
  document.querySelectorAll('.nail-thumb-wrap').forEach((wrap) => {
    wrap.addEventListener('click', () => {
      document.querySelectorAll('.nail-thumb-wrap').forEach(w => w.classList.remove('active'));
      wrap.classList.add('active');
      setActiveNail(wrap.dataset.finger);
    });
  });

  // Tool tabs
  document.querySelectorAll('.tool-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`panel-${tab.dataset.tool}`);
      if (panel) panel.classList.add('active');
    });
  });

  // Finish type pills
  document.querySelectorAll('.finish-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.finish-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setFinishType(btn.dataset.finish);
    });
  });

  // Color category tabs + swatches
  buildColorSwatches('pinks'); // initial
  document.querySelectorAll('.color-cat').forEach((cat) => {
    cat.addEventListener('click', () => {
      document.querySelectorAll('.color-cat').forEach(c => c.classList.remove('active'));
      cat.classList.add('active');
      buildColorSwatches(cat.dataset.cat);
    });
  });

  // Gradient direction
  document.querySelectorAll('.dir-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('apply-gradient-btn').addEventListener('click', () => {
    const c1  = document.getElementById('grad-color1').value;
    const c2  = document.getElementById('grad-color2').value;
    const dir = document.querySelector('.dir-btn.active')?.dataset.dir || 'vertical';
    applyGradient(c1, c2, dir);
  });

  // Brush controls
  document.getElementById('brush-size').addEventListener('input', (e) => {
    BrushState.size = parseInt(e.target.value);
    document.getElementById('brush-size-val').textContent = e.target.value;
  });
  document.getElementById('brush-opacity').addEventListener('input', (e) => {
    BrushState.opacity = e.target.value / 100;
    document.getElementById('brush-opacity-val').textContent = e.target.value;
  });
  document.getElementById('brush-color-input').addEventListener('input', (e) => {
    BrushState.color = e.target.value;
  });

  // Eraser controls
  document.getElementById('eraser-size').addEventListener('input', (e) => {
    BrushState.eraserSize = parseInt(e.target.value);
    document.getElementById('eraser-size-val').textContent = e.target.value;
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  // Apply to all / Undo
  document.getElementById('apply-all-btn').addEventListener('click', () => applyToAllNails());
  document.getElementById('undo-btn').addEventListener('click', () => undo());

  // Step 3 back
  document.getElementById('step3-back').addEventListener('click', () => goToStep(2));

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
  // Download → Web Share API (saves to iOS Photos) with fallback
  document.getElementById('download-btn').addEventListener('click', async () => {
    const img = document.getElementById('result-generated');
    if (!img?.src) return;
    try {
      const resp = await fetch(img.src);
      const blob = await resp.blob();
      const file = new File([blob], 'nail-preview.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Nail Preview — DYN' });
      } else {
        // Desktop fallback: direct download
        const a = document.createElement('a');
        a.href     = img.src;
        a.download = 'nail-preview.png';
        a.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Share/download error:', err);
    }
  });

  document.getElementById('try-again-btn').addEventListener('click', () => reGenerate());
  document.getElementById('retry-btn').addEventListener('click',     () => reGenerate());

  document.getElementById('start-over-btn').addEventListener('click', () => {
    goToStep(1); resetApp();
  });
  document.getElementById('error-start-over-btn').addEventListener('click', () => {
    goToStep(1); resetApp();
  });
}

async function reGenerate() {
  showLoading();
  try {
    const generatedB64 = await submitGeneration(AppState);
    renderResult(AppState.handPhotoBlob, generatedB64);
  } catch (err) {
    renderError(err.message);
  }
}

function showLoading() {
  document.getElementById('result-loading').style.display = '';
  document.getElementById('result-success').hidden = true;
  document.getElementById('result-error').hidden   = true;
}

function resetApp() {
  AppState.handPhotoBlob  = null;
  AppState.handPhotoImg   = null;
  AppState.nailPositions  = [];
  AppState.nailShape      = 'oval';
  AppState.nailLength     = 'medium';
  AppState.sizeMultiplier = 1.0;
  step3Initialized        = false;

  resetZoom();

  // Reset step 1 UI
  document.getElementById('gallery-input').value  = '';
  document.getElementById('camera-input').value   = '';
  document.getElementById('upload-options').hidden = false;
  document.getElementById('preview-wrap').hidden   = true;
  document.getElementById('step1-next').disabled   = true;

  // Reset sliders
  const rs = document.getElementById('rotation-slider');
  if (rs) { rs.value = 0; prevRotVal = 0; document.getElementById('rotation-val').textContent = '0°'; }
}

document.addEventListener('DOMContentLoaded', initApp);

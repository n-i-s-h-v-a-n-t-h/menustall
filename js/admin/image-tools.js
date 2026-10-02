// Photo helpers for the dashboard: pick from camera/gallery, crop to a
// square (drag to move, slider or pinch to zoom), then compress in the
// browser so uploads stay small (~800px, ≤ 200 KB) on slow connections.

import { h, icon, openSheet, button, toast } from '../lib/ui.js';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Open the system picker (camera or gallery on phones). Resolves to a File or null. */
export function pickImageFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    let settled = false;
    const done = (file) => { if (!settled) { settled = true; input.remove(); resolve(file); } };
    input.addEventListener('change', () => done(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Encode as WebP (or JPEG where WebP encoding isn't supported) under maxBytes. */
export async function compressCanvas(canvas, maxBytes = 200 * 1024) {
  for (const type of ['image/webp', 'image/jpeg']) {
    let blob = null;
    for (let q = 0.86; q >= 0.4; q -= 0.08) {
      blob = await toBlob(canvas, type, q);
      if (!blob || blob.type !== type) break; // browser can't encode this type
      if (blob.size <= maxBytes) return blob;
    }
    if (blob && blob.type === type) {
      // Still too big at low quality: shrink the canvas and try once more.
      const small = document.createElement('canvas');
      small.width = Math.round(canvas.width * 0.75);
      small.height = Math.round(canvas.height * 0.75);
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      return compressCanvas(small, maxBytes);
    }
  }
  return toBlob(canvas, 'image/jpeg', 0.7);
}

/**
 * Show the square cropper for `file`. Resolves to a compressed Blob, or
 * null if the owner cancels.
 */
export async function cropImage(file, { size = 800, maxBytes = 200 * 1024, title = 'Crop photo', round = false } = {}) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) {
    toast('That file isn’t an image. Choose a JPEG, PNG or WebP photo.', { type: 'error' });
    return null;
  }
  if (file.size > MAX_SOURCE_BYTES) {
    toast('That photo is over 20 MB. Choose a smaller one.', { type: 'error' });
    return null;
  }

  let source;
  try {
    source = await decode(file);
  } catch {
    toast('Couldn’t read that photo. Try a JPEG or PNG.', { type: 'error' });
    return null;
  }

  const sw = source.width;
  const sh = source.height;
  const STAGE = 320; // logical px of the on-screen square
  const minScale = Math.max(STAGE / sw, STAGE / sh); // "cover"
  const view = { zoom: 1, x: 0, y: 0 }; // x/y = offset of image centre from stage centre, in stage px

  const canvas = h('canvas', { class: 'crop-canvas', width: STAGE * 2, height: STAGE * 2, 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  const stage = h('div', {
    class: `crop-stage ${round ? 'is-round' : ''}`,
    tabindex: '0',
    role: 'application',
    'aria-label': 'Photo crop area. Drag or use arrow keys to move, plus and minus to zoom.',
  }, canvas, h('div', { class: 'crop-grid', 'aria-hidden': 'true' }));
  const zoomInput = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', id: 'crop-zoom', class: 'crop-zoom' });

  const clamp = () => {
    const s = minScale * view.zoom;
    const maxX = Math.max(0, (sw * s - STAGE) / 2);
    const maxY = Math.max(0, (sh * s - STAGE) / 2);
    view.x = Math.max(-maxX, Math.min(maxX, view.x));
    view.y = Math.max(-maxY, Math.min(maxY, view.y));
  };

  const drawTo = (context, px, wipe = true) => {
    const k = px / STAGE;
    const s = minScale * view.zoom * k;
    if (wipe) context.clearRect(0, 0, px, px);
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, px / 2 + view.x * k - (sw * s) / 2, px / 2 + view.y * k - (sh * s) / 2, sw * s, sh * s);
  };

  const paint = () => { clamp(); drawTo(ctx, canvas.width); };

  // Drag + pinch with pointer events.
  const pointers = new Map();
  let pinchStart = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const rect = stage.getBoundingClientRect();
    const ratio = STAGE / rect.width;
    if (pointers.size === 1) {
      view.x += (e.clientX - prev.x) * ratio;
      view.y += (e.clientY - prev.y) * ratio;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      view.zoom = Math.max(1, Math.min(4, pinchStart.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.dist)));
      zoomInput.value = String(view.zoom);
    }
    paint();
  });
  const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom = Math.max(1, Math.min(4, view.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    zoomInput.value = String(view.zoom);
    paint();
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 8;
    const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key]) { view.x += map[e.key][0]; view.y += map[e.key][1]; }
    else if (e.key === '+' || e.key === '=') view.zoom = Math.min(4, view.zoom + 0.1);
    else if (e.key === '-') view.zoom = Math.max(1, view.zoom - 0.1);
    else return;
    e.preventDefault();
    zoomInput.value = String(view.zoom);
    paint();
  });
  zoomInput.addEventListener('input', () => { view.zoom = Number(zoomInput.value); paint(); });

  const content = h('div', { class: 'cropper' },
    stage,
    h('div', { class: 'crop-controls' },
      icon('image', { size: 16 }),
      h('label', { class: 'sr-only', for: 'crop-zoom' }, 'Zoom'),
      zoomInput,
      icon('zoomIn', { size: 20 }),
    ),
    h('p', { class: 'field-hint crop-hint' }, 'Drag to position. The square is exactly what customers will see.'),
  );

  return new Promise((resolve) => {
    let result = null;
    const useBtn = button('Use photo', { icon: 'check', variant: 'primary', size: 'lg' });
    const cancelBtn = button('Cancel', { variant: 'secondary', size: 'lg' });
    const sheet = openSheet({
      title,
      content,
      footer: h('div', { class: 'confirm-actions' }, cancelBtn, useBtn),
      variant: 'bottom',
      className: 'crop-sheet',
      onClose: () => resolve(result),
      initialFocus: stage,
    });
    cancelBtn.addEventListener('click', () => sheet.close());
    useBtn.addEventListener('click', async () => {
      useBtn.disabled = true;
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff'; // JPEG has no transparency
      octx.fillRect(0, 0, size, size);
      drawTo(octx, size, false);
      result = await compressCanvas(out, maxBytes);
      sheet.close();
    });
    paint();
  });
}

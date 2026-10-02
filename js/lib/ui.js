// Shared UI toolkit: safe DOM building, icons, toasts, dialogs, sheets,
// theme handling and drag-to-reorder. No user data ever goes through
// innerHTML here — `h()` only creates text nodes for strings.

/* ------------------------------------------------------------------ */
/* Icons — Lucide-style 24px strokes, bundled so there's no icon font. */
/* These strings are trusted constants, never user data.               */
/* ------------------------------------------------------------------ */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  package: '<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v4h-3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  wifiOff: '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  store: '<path d="m2 7 1.6-3.2A2 2 0 0 1 5.4 3h13.2a2 2 0 0 1 1.8 1.1L22 7M2 7h20M2 7v2a3 3 0 0 0 6 0V7m0 2a3 3 0 0 0 6 0V7m0 2a3 3 0 0 0 6 0V7M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M9 21v-5h6v5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  sunrise: '<path d="M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  zip: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M10 9h1M10 12h1M10 15h1M10 18h2"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  table: '<path d="M3 7h18M5 7v13M19 7v13M3 4h18"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an inline SVG icon. `name` must be a key of ICONS. */
export function icon(name, { size = 20, className = '', strokeWidth = 2 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = ICONS[name] || ICONS.info; // trusted constant markup only
  return svg;
}

/* ------------------------------------------------------------------ */
/* Safe DOM helpers                                                    */
/* ------------------------------------------------------------------ */

/** Escape a string for the rare case HTML text must be composed. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Hyperscript-style element builder. Strings become text nodes, so user
 * data can be passed straight in without any escaping worries.
 *   h('button', { class: 'btn', onClick: fn, 'aria-label': 'Add' }, 'Add')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string' && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Put a button into a loading state (keeps its width, blocks double taps). */
export function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    const span = button.querySelector('.btn-label');
    if (span && busyLabel) {
      if (!button.dataset.labelText) button.dataset.labelText = span.textContent;
      span.textContent = busyLabel;
    }
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    const span = button.querySelector('.btn-label');
    if (span && button.dataset.labelText) span.textContent = button.dataset.labelText;
  }
}

/** Button with icon + label, the most common pattern in the app. */
export function button(label, { icon: iconName, variant = 'secondary', size, className = '', onClick, type = 'button', title, ariaLabel, disabled } = {}) {
  const cls = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className].filter(Boolean).join(' ');
  const labelEl = label ? h('span', { class: 'btn-label' }, label) : null;
  const btn = h('button', { type, class: cls, onClick, title, 'aria-label': ariaLabel, disabled }, iconName ? icon(iconName, { size: 18 }) : null, labelEl);
  if (label) btn.dataset.labelText = label;
  return btn;
}

/* ------------------------------------------------------------------ */
/* Live region + toasts                                                */
/* ------------------------------------------------------------------ */

let toastRegion;
let liveRegion;

function ensureRegions() {
  if (!toastRegion) {
    toastRegion = h('div', { class: 'toast-region', role: 'region', 'aria-label': 'Notifications' });
    document.body.appendChild(toastRegion);
  }
  if (!liveRegion) {
    liveRegion = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(liveRegion);
  }
}

/** Announce text to screen readers without showing anything. */
export function announce(message) {
  ensureRegions();
  liveRegion.textContent = '';
  // A tick later so repeated identical messages are still announced.
  setTimeout(() => { liveRegion.textContent = message; }, 30);
}

const TOAST_ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };

/**
 * Show a toast. Returns { dismiss }.
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error'|'warning', action?: {label: string, onClick: Function}, duration?: number, emoji?: string}} opts
 */
export function toast(message, { type = 'info', action, duration, emoji } = {}) {
  ensureRegions();
  const ttl = duration ?? (action ? 5000 : type === 'error' ? 6000 : 3200);
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    emoji ? h('span', { class: 'toast-emoji', 'aria-hidden': 'true' }, emoji) : icon(TOAST_ICONS[type] || 'info', { size: 18, className: 'toast-icon' }),
    h('span', { class: 'toast-msg' }, message),
  );

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 200);
  };

  if (action) {
    el.appendChild(h('button', {
      type: 'button',
      class: 'toast-action',
      onClick: () => { dismiss(); action.onClick(); },
    }, action.label));
  }
  el.appendChild(h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onClick: dismiss }, icon('x', { size: 16 })));

  // Keep the stack short on small screens.
  while (toastRegion.children.length >= 3) toastRegion.firstElementChild.remove();
  toastRegion.appendChild(el);
  if (type !== 'error') announce(message);

  if (ttl > 0) {
    const start = () => { timer = setTimeout(dismiss, ttl); };
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', start);
    el.addEventListener('focusin', () => clearTimeout(timer));
    start();
  }
  return { dismiss };
}

/* ------------------------------------------------------------------ */
/* Sheets & dialogs (native <dialog> → free focus trap + Esc + top layer)*/
/* ------------------------------------------------------------------ */

let sheetCount = 0;

/**
 * Open a sheet. variant: 'bottom' (mobile bottom sheet, centred modal on
 * desktop), 'side' (slide-over on desktop, full screen on mobile), 'full'.
 * Returns { dialog, body, footer, close, setTitle }.
 */
export function openSheet({ title = '', content, footer, variant = 'bottom', onClose, beforeClose, className = '', hideTitle = false, initialFocus } = {}) {
  const id = `sheet-title-${++sheetCount}`;
  const titleEl = h('h2', { class: `sheet-title ${hideTitle ? 'sr-only' : ''}`, id }, title);
  const closeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon sheet-close', 'aria-label': 'Close' }, icon('x', { size: 22 }));
  const body = h('div', { class: 'sheet-body' });
  const footerEl = h('div', { class: 'sheet-footer' });
  if (content) appendChildren(body, [content]);
  if (footer) appendChildren(footerEl, [footer]);
  else footerEl.hidden = true;

  const dialog = h('dialog', { class: `sheet sheet--${variant} ${className}`.trim(), 'aria-labelledby': id },
    h('div', { class: 'sheet-panel' },
      variant === 'bottom' ? h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }) : null,
      h('header', { class: `sheet-header ${hideTitle ? 'sheet-header--bare' : ''}` }, titleEl, closeBtn),
      body,
      footerEl,
    ),
  );

  let closed = false;
  const lastFocus = document.activeElement;

  let asking = false;
  const close = async (reason) => {
    if (closed || asking) return;
    // Let the owner of the sheet veto user-initiated closes (e.g. unsaved changes).
    if (beforeClose && ['button', 'escape', 'backdrop'].includes(reason)) {
      asking = true;
      const ok = await beforeClose(reason);
      asking = false;
      if (!ok) return;
    }
    closed = true;
    dialog.classList.add('is-closing');
    const finish = () => {
      dialog.close();
      dialog.remove();
      document.documentElement.classList.toggle('has-sheet', !!document.querySelector('dialog.sheet[open]'));
      if (lastFocus && typeof lastFocus.focus === 'function' && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
      onClose && onClose(reason);
    };
    if (prefersReducedMotion()) finish();
    else setTimeout(finish, 200);
  };

  closeBtn.addEventListener('click', () => close('button'));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close('escape'); });
  // Tap on the backdrop closes the sheet.
  dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) dialog.dataset.downOnBackdrop = '1'; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && dialog.dataset.downOnBackdrop === '1') close('backdrop');
    delete dialog.dataset.downOnBackdrop;
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  document.documentElement.classList.add('has-sheet');
  if (initialFocus) {
    const target = typeof initialFocus === 'string' ? dialog.querySelector(initialFocus) : initialFocus;
    if (target) target.focus();
  } else {
    // Don't pop the keyboard on mobile: focus the panel, not the first input.
    closeBtn.focus({ preventScroll: true });
  }

  return {
    dialog,
    body,
    footer: footerEl,
    close,
    setTitle: (t) => { titleEl.textContent = t; },
    setFooter: (node) => { clear(footerEl); if (node) { appendChildren(footerEl, [node]); footerEl.hidden = false; } else footerEl.hidden = true; },
  };
}

/** Promise-based confirm dialog. Resolves true when confirmed. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, icon: iconName } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const confirmBtn = button(confirmLabel, { variant: danger ? 'danger' : 'primary', size: 'lg' });
    const cancelBtn = button(cancelLabel, { variant: 'secondary', size: 'lg' });
    const content = h('div', { class: 'confirm' },
      iconName ? h('div', { class: `confirm-icon ${danger ? 'is-danger' : ''}` }, icon(iconName, { size: 26 })) : null,
      message ? h('p', { class: 'confirm-msg' }, message) : null,
    );
    const sheet = openSheet({
      title,
      content,
      footer: h('div', { class: 'confirm-actions' }, cancelBtn, confirmBtn),
      variant: 'bottom',
      className: 'sheet--confirm',
      onClose: () => resolve(result),
      initialFocus: confirmBtn,
    });
    sheet.dialog.setAttribute('role', 'alertdialog');
    confirmBtn.addEventListener('click', () => { result = true; sheet.close('confirm'); });
    cancelBtn.addEventListener('click', () => sheet.close('cancel'));
  });
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

const THEME_KEY = 'chaimenu:theme';

export function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

export function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#17100C' : '#FFF8EE');
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

/** A round button that flips light/dark and remembers the choice. */
export function themeToggle(className = 'btn btn-ghost btn-icon') {
  const btn = h('button', { type: 'button', class: `${className} theme-toggle` });
  const paint = () => {
    const dark = effectiveTheme() === 'dark';
    clear(btn).appendChild(icon(dark ? 'sun' : 'moon', { size: 20 }));
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Light mode' : 'Dark mode';
  };
  btn.addEventListener('click', () => { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); });
  document.addEventListener('themechange', paint);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paint);
  paint();
  return btn;
}

/* ------------------------------------------------------------------ */
/* Small widgets                                                       */
/* ------------------------------------------------------------------ */

/** A big accessible on/off switch. onChange receives the new boolean. */
export function toggleSwitch({ checked = false, onLabel = 'On', offLabel = 'Off', ariaLabel, onChange, className = '' } = {}) {
  const label = h('span', { class: 'switch-label' });
  const btn = h('button', { type: 'button', role: 'switch', class: `switch ${className}`.trim(), 'aria-label': ariaLabel },
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
    label,
  );
  const set = (value) => {
    btn.setAttribute('aria-checked', value ? 'true' : 'false');
    btn.classList.toggle('is-on', !!value);
    label.textContent = value ? onLabel : offLabel;
  };
  set(checked);
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    set(next);
    onChange && onChange(next);
  });
  btn.setChecked = set;
  return btn;
}

/** − qty + stepper. onChange receives the new number. */
export function stepper({ value = 1, min = 0, max = 99, onChange, label = 'Quantity', size = '' } = {}) {
  let current = value;
  const out = h('output', { class: 'stepper-value', 'aria-live': 'polite' }, String(current));
  const dec = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Decrease ${label}` }, icon('minus', { size: 18 }));
  const inc = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Increase ${label}` }, icon('plus', { size: 18 }));
  const wrap = h('div', { class: `stepper ${size ? `stepper-${size}` : ''}`.trim(), role: 'group', 'aria-label': label }, dec, out, inc);
  const paint = () => {
    out.textContent = String(current);
    dec.disabled = current <= min;
    inc.disabled = current >= max;
  };
  const set = (v, fire = true) => {
    const next = Math.max(min, Math.min(max, v));
    if (next === current && fire) return;
    current = next;
    paint();
    if (fire && onChange) onChange(current);
  };
  dec.addEventListener('click', () => set(current - 1));
  inc.addEventListener('click', () => set(current + 1));
  paint();
  wrap.setValue = (v) => set(v, false);
  wrap.getValue = () => current;
  wrap.setMax = (m) => { max = m; paint(); };
  return wrap;
}

/** Skeleton block with shimmer. */
export const skeleton = (className = '') => h('div', { class: `skeleton ${className}`.trim(), 'aria-hidden': 'true' });

/** Empty / error state block. */
export function emptyState({ emoji = '🍵', title, message, action } = {}) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, emoji),
    title ? h('h3', { class: 'empty-title' }, title) : null,
    message ? h('p', { class: 'empty-msg' }, message) : null,
    action || null,
  );
}

/** Load a classic (UMD) script once, e.g. jsPDF / JSZip from the CDN. */
const scriptCache = new Map();
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { scriptCache.delete(src); reject(new Error(`Couldn't load ${src}. Check your internet connection.`)); };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

/** Trigger a file download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/* Drag to reorder (pointer events → works with mouse, touch and pen)  */
/* ------------------------------------------------------------------ */

/**
 * Make the children of `list` sortable by dragging their handle.
 * onEnd(ids) receives the new order of `data-id`s when the order changed.
 */
export function makeSortable(list, { itemSelector = '[data-id]', handleSelector = '.drag-handle', onEnd } = {}) {
  let dragging = null;
  let startY = 0;
  let startOrder = [];
  let pointerId = null;

  const items = () => Array.from(list.children).filter((el) => el.matches(itemSelector));

  const onDown = (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !list.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item || item.parentElement !== list) return;
    e.preventDefault();
    dragging = item;
    pointerId = e.pointerId;
    startY = e.clientY;
    startOrder = items().map((el) => el.dataset.id);
    handle.setPointerCapture?.(e.pointerId);
    item.classList.add('is-dragging');
    list.classList.add('is-sorting');
  };

  const onMove = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();
    const dy = e.clientY - startY;
    dragging.style.transform = `translateY(${dy}px)`;
    // Swap with neighbours once the dragged row passes their midpoint.
    const rect = dragging.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const prev = dragging.previousElementSibling;
    const next = dragging.nextElementSibling;
    if (prev && prev.matches(itemSelector)) {
      const r = prev.getBoundingClientRect();
      if (mid < r.top + r.height / 2) {
        list.insertBefore(dragging, prev);
        startY -= r.height + parseFloat(getComputedStyle(list).rowGap || 0);
        dragging.style.transform = `translateY(${e.clientY - startY}px)`;
        return;
      }
    }
    if (next && next.matches(itemSelector)) {
      const r = next.getBoundingClientRect();
      if (mid > r.top + r.height / 2) {
        list.insertBefore(next, dragging);
        startY += r.height + parseFloat(getComputedStyle(list).rowGap || 0);
        dragging.style.transform = `translateY(${e.clientY - startY}px)`;
      }
    }
  };

  const onUp = (e) => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging.style.transform = '';
    dragging.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    const order = items().map((el) => el.dataset.id);
    dragging = null;
    pointerId = null;
    if (order.join() !== startOrder.join() && onEnd) onEnd(order);
  };

  list.addEventListener('pointerdown', onDown);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', onUp);
  list.addEventListener('pointercancel', onUp);
  return () => {
    list.removeEventListener('pointerdown', onDown);
    list.removeEventListener('pointermove', onMove);
    list.removeEventListener('pointerup', onUp);
    list.removeEventListener('pointercancel', onUp);
  };
}

/** Run a callback when the user returns to the tab after `minAwayMs`. */
export function onReturn(callback, minAwayMs = 30000) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > minAwayMs) callback();
  });
}

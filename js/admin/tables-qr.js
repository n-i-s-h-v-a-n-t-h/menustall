// Tables & QR tab, plus the table-card renderer shared with print.html.
// Cards are drawn on a <canvas> in the browser: brand colours around the
// edge, but the QR itself is always dark-on-white with a quiet zone and
// high error correction so it scans reliably even when laminated.

import { store, subscribe, reloadTables, menuUrlFor, menuBaseUrl, isLocalUrl } from './store.js';
import { sb, run } from '../lib/supabase.js';
import { h, icon, clear, toast, confirmDialog, button, setBusy, loadScript, downloadBlob, emptyState } from '../lib/ui.js';
import { plural } from '../lib/format.js';

const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const LOGO_PREF = 'chaimenu:qr-logo';

export const CARD_W = 1200;
export const CARD_H = 1700;

/* ------------------------------------------------------------------ */
/* Card renderer                                                       */
/* ------------------------------------------------------------------ */

let qrLib = null;
export async function loadQrLib() {
  if (!qrLib) {
    const mod = await import(QR_URL);
    qrLib = mod.default && mod.default.create ? mod.default : mod;
  }
  return qrLib;
}

const imageCache = new Map();
export function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // keeps the canvas exportable
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

let fontsReady = null;
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = document.fonts
      ? Promise.all([
          document.fonts.load('700 64px "Fraunces"'),
          document.fonts.load('700 48px "Plus Jakarta Sans"'),
          document.fonts.load('800 48px "Plus Jakarta Sans"'),
        ]).catch(() => {})
      : Promise.resolve();
  }
  return fontsReady;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx, text, maxWidth, size, family, weight = 700) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 4;
  } while (s > 24);
  return s;
}

const DISPLAY = '"Fraunces", Georgia, serif';
const UI = '"Plus Jakarta Sans", system-ui, sans-serif';

/**
 * Draw one table tent card. Returns a canvas.
 * opts: { tableNumber, url, shopName, logoUrl, withLogo, scale }
 */
export async function drawTableCard({ tableNumber, url, shopName = 'Our Menu', logoUrl, withLogo = false, scale = 1 }) {
  const QR = await loadQrLib();
  await ensureFonts();
  const logo = logoUrl ? await loadImage(logoUrl) : null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD_W * scale);
  canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Background
  ctx.fillStyle = '#FFF8EE';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Top band with a soft curve and steam swirls
  ctx.fillStyle = '#6B3E26';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(CARD_W, 0);
  ctx.lineTo(CARD_W, 330);
  ctx.quadraticCurveTo(CARD_W / 2, 400, 0, 330);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(232, 163, 61, 0.35)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  for (const x of [1030, 1080, 1130]) {
    ctx.beginPath();
    ctx.moveTo(x, 250);
    ctx.bezierCurveTo(x - 40, 210, x + 40, 170, x, 130);
    ctx.bezierCurveTo(x - 40, 90, x + 30, 60, x, 30);
    ctx.stroke();
  }

  // Logo disc
  ctx.save();
  ctx.fillStyle = '#FFF8EE';
  ctx.beginPath();
  ctx.arc(CARD_W / 2, 120, 72, 0, Math.PI * 2);
  ctx.fill();
  if (logo) {
    ctx.beginPath();
    ctx.arc(CARD_W / 2, 120, 64, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max(128 / logo.width, 128 / logo.height);
    ctx.drawImage(logo, CARD_W / 2 - (logo.width * s) / 2, 120 - (logo.height * s) / 2, logo.width * s, logo.height * s);
  } else {
    ctx.fillStyle = '#6B3E26';
    ctx.font = `72px ${UI}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('☕', CARD_W / 2, 124);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // Shop name
  ctx.fillStyle = '#FFF8EE';
  const nameSize = fitFont(ctx, shopName, 1040, 76, DISPLAY);
  ctx.font = `700 ${nameSize}px ${DISPLAY}`;
  ctx.fillText(shopName, CARD_W / 2, 280);

  // Call to action
  ctx.fillStyle = '#6B3E26';
  ctx.font = `800 58px ${UI}`;
  ctx.fillText('Scan for menu 📱', CARD_W / 2, 480);

  // QR panel — always dark on white with a 4-module quiet zone.
  const qr = QR.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const panel = 700;
  const px = (CARD_W - panel) / 2;
  const py = 530;
  ctx.save();
  ctx.shadowColor = 'rgba(74, 44, 26, 0.18)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, px, py, panel, panel, 40);
  ctx.fill();
  ctx.restore();

  const cell = Math.floor(panel / (n + 8));
  const qrSize = cell * n;
  const qx = Math.round(px + (panel - qrSize) / 2);
  const qy = Math.round(py + (panel - qrSize) / 2);
  ctx.fillStyle = '#17100C';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);
    }
  }

  // Optional logo in the centre (≤ ~5% of the code; level H recovers 30%).
  if (withLogo && logo) {
    const box = Math.round(qrSize * 0.22);
    const bx = qx + (qrSize - box) / 2;
    const by = qy + (qrSize - box) / 2;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, bx - 8, by - 8, box + 16, box + 16, 20);
    ctx.fill();
    ctx.save();
    roundRect(ctx, bx, by, box, box, 14);
    ctx.clip();
    const s = Math.max(box / logo.width, box / logo.height);
    ctx.drawImage(logo, bx + box / 2 - (logo.width * s) / 2, by + box / 2 - (logo.height * s) / 2, logo.width * s, logo.height * s);
    ctx.restore();
  }

  // TABLE n
  ctx.fillStyle = '#8C7B70';
  ctx.font = `800 44px ${UI}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '12px';
  ctx.fillText('TABLE', CARD_W / 2 + 6, 1325);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#6B3E26';
  ctx.font = `700 170px ${DISPLAY}`;
  ctx.fillText(String(tableNumber), CARD_W / 2, 1490);

  // Footer band
  ctx.fillStyle = '#E8A33D';
  ctx.fillRect(0, 1570, CARD_W, CARD_H - 1570);
  ctx.fillStyle = '#2A1B14';
  ctx.font = `700 50px ${UI}`;
  ctx.fillText('Order & pay at the counter 🙏', CARD_W / 2, 1652);

  return canvas;
}

/** Everything the renderer needs, from the current settings. */
export function cardOptions(tableNumber, extra = {}) {
  let withLogo = false;
  try { withLogo = localStorage.getItem(LOGO_PREF) === '1'; } catch { /* ignore */ }
  return {
    tableNumber,
    url: menuUrlFor(tableNumber),
    shopName: store.settings?.shop_name || 'Our Menu',
    logoUrl: store.settings?.logo_url || null,
    withLogo,
    ...extra,
  };
}

const canvasBlob = (canvas, type = 'image/png', q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

export async function cardPng(tableNumber) {
  const canvas = await drawTableCard(cardOptions(tableNumber));
  return canvasBlob(canvas);
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

const fileSafe = (s) => String(s || 'menu').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'menu';

async function downloadZip(tables, onProgress) {
  await loadScript(JSZIP_URL);
  const zip = new window.JSZip();
  let i = 0;
  for (const t of tables) {
    zip.file(`table-${t.table_number}.png`, await cardPng(t.table_number));
    onProgress?.(++i, tables.length);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${fileSafe(store.settings?.shop_name)}-qr-cards.zip`);
}

async function downloadPdf(tables, onProgress) {
  await loadScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  // 2 × 2 cards per A4 page, 90 × 127.5 mm each, with cut lines.
  const w = 90;
  const hgt = (w * CARD_H) / CARD_W;
  const gapX = 10;
  const gapY = 12;
  const left = (210 - (2 * w + gapX)) / 2;
  const top = (297 - (2 * hgt + gapY)) / 2;
  let i = 0;
  for (const t of tables) {
    const slot = i % 4;
    if (i > 0 && slot === 0) doc.addPage();
    const x = left + (slot % 2) * (w + gapX);
    const y = top + Math.floor(slot / 2) * (hgt + gapY);
    const canvas = await drawTableCard(cardOptions(t.table_number));
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, hgt, undefined, 'FAST');
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + hgt], [x + w, y + hgt]]) {
      const dx = cx === x ? -1 : 1;
      const dy = cy === y ? -1 : 1;
      doc.line(cx + dx * 1.5, cy, cx + dx * 5, cy);
      doc.line(cx, cy + dy * 1.5, cx, cy + dy * 5);
    }
    onProgress?.(++i, tables.length);
  }
  doc.save(`${fileSafe(store.settings?.shop_name)}-qr-cards.pdf`);
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export function mount(panel) {
  const activeTables = () => store.tables.filter((t) => t.is_active).sort((a, b) => a.table_number - b.table_number);

  const countIn = h('input', { class: 'input count-input', id: 'table-count', type: 'number', min: 1, max: 500, inputmode: 'numeric', 'aria-describedby': 'table-count-hint table-count-error' });
  const countErr = h('p', { class: 'field-error', id: 'table-count-error' });
  const generateBtn = button('Generate', { icon: 'qr', variant: 'primary', size: 'lg', type: 'submit' });
  const warning = h('div', { class: 'notice notice-warning', role: 'alert', hidden: true });
  const zipBtn = button('All as ZIP', { icon: 'zip', variant: 'secondary' });
  const pdfBtn = button('All as A4 PDF', { icon: 'file', variant: 'secondary' });
  const printLink = h('a', { class: 'btn btn-secondary', href: 'print.html', target: '_blank', rel: 'noopener' }, icon('printer', { size: 18 }), h('span', { class: 'btn-label' }, 'Print cards'));
  const addOneBtn = button('Add one table', { icon: 'plus', variant: 'ghost' });
  const logoCheck = h('input', { type: 'checkbox', id: 'qr-logo' });
  const logoLabel = h('label', { class: 'check', for: 'qr-logo' }, logoCheck, 'Shop logo in the centre of the QR');
  const grid = h('div', { class: 'qr-grid' });
  const progress = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });

  try { logoCheck.checked = localStorage.getItem(LOGO_PREF) === '1'; } catch { /* ignore */ }

  panel.append(
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'panel-title display', id: 'h-tables' }, 'Tables & QR'),
        h('p', { class: 'panel-sub' }, 'One QR card per table. Customers scan it to open your live menu with their table number.'),
      ),
    ),
    warning,
    h('div', { class: 'card pad' },
      h('form', { class: 'count-form', novalidate: true, onSubmit: (e) => { e.preventDefault(); generate(); } },
        h('div', { class: 'field' },
          h('label', { class: 'field-label', for: 'table-count' }, 'How many tables?'),
          h('div', { class: 'count-row' }, countIn, generateBtn),
          h('p', { class: 'field-hint', id: 'table-count-hint' }, 'Lowering the number deactivates the extra tables — they’re hidden here and from printing, never deleted, and come back if you raise the number again.'),
          countErr,
        ),
      ),
    ),
    h('div', { class: 'card pad qr-actions' },
      h('div', { class: 'qr-actions-row' }, zipBtn, pdfBtn, printLink, addOneBtn),
      logoLabel,
      progress,
    ),
    grid,
  );

  logoCheck.addEventListener('change', () => {
    try { localStorage.setItem(LOGO_PREF, logoCheck.checked ? '1' : '0'); } catch { /* ignore */ }
    renderGrid();
  });

  /* --- warnings --- */
  function paintWarning() {
    const base = menuBaseUrl();
    clear(warning);
    if (isLocalUrl(base)) {
      warning.hidden = false;
      warning.append(icon('alert', { size: 20 }), h('div', {},
        h('strong', {}, 'These QR codes won’t work on customers’ phones yet. '),
        `They point to ${base}, which only exists on this computer. Deploy the site, then set the QR base URL in `,
        h('a', { href: '#settings' }, 'Settings'), '.',
      ));
    } else {
      warning.hidden = true;
    }
    logoLabel.hidden = !store.settings?.logo_url;
  }

  /* --- grid --- */
  let renderToken = 0;
  async function renderGrid() {
    const token = ++renderToken;
    const tables = activeTables();
    countIn.value = countIn.value && document.activeElement === countIn ? countIn.value : String(tables.length || '');
    clear(grid);
    zipBtn.disabled = pdfBtn.disabled = !tables.length;
    printLink.classList.toggle('is-disabled', !tables.length);
    paintWarning();
    if (!tables.length) {
      grid.appendChild(emptyState({ emoji: '🪑', title: 'No tables yet', message: 'Enter how many tables you have and tap Generate.' }));
      return;
    }
    const inactive = store.tables.length - tables.length;
    progress.textContent = `${plural(tables.length, 'active table')}${inactive ? ` · ${inactive} deactivated` : ''}`;

    const slots = tables.map((t) => {
      const img = h('img', { class: 'qr-preview', alt: `QR card for table ${t.table_number}`, width: 300, height: 425 });
      const ph = h('div', { class: 'qr-preview skeleton' });
      const pngBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `Download table ${t.table_number} card as PNG` }, icon('download', { size: 16 }), 'PNG');
      pngBtn.addEventListener('click', async () => {
        setBusy(pngBtn, true);
        try {
          downloadBlob(await cardPng(t.table_number), `table-${t.table_number}.png`);
        } catch (err) {
          toast(`Couldn’t make the PNG. ${err.message || ''}`, { type: 'error' });
        }
        setBusy(pngBtn, false);
      });
      const testLink = h('a', { class: 'btn btn-ghost btn-sm', href: menuUrlFor(t.table_number), target: '_blank', rel: 'noopener', 'aria-label': `Test table ${t.table_number}: open its menu in a new tab` }, icon('external', { size: 16 }), 'Test');
      const fig = h('figure', { class: 'qr-card card' },
        ph,
        h('figcaption', { class: 'qr-caption' }, h('strong', {}, `Table ${t.table_number}`), h('div', { class: 'qr-card-actions' }, testLink, pngBtn)),
      );
      grid.appendChild(fig);
      return { t, img, ph };
    });

    // Draw previews one by one so the page stays responsive.
    for (const s of slots) {
      if (token !== renderToken) return;
      try {
        const canvas = await drawTableCard(cardOptions(s.t.table_number, { scale: 0.3 }));
        if (token !== renderToken) return;
        s.img.src = canvas.toDataURL('image/png');
        s.ph.replaceWith(s.img);
      } catch (err) {
        s.ph.replaceWith(h('p', { class: 'qr-preview qr-error' }, 'Couldn’t draw this QR. Check your internet connection.'));
        console.error(err);
        break;
      }
    }
  }

  /* --- actions --- */
  async function generate() {
    const n = Number.parseInt(countIn.value, 10);
    clear(countErr);
    countIn.setAttribute('aria-invalid', 'false');
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      countErr.append(icon('alert', { size: 14 }), 'Enter a number from 1 to 500.');
      countIn.setAttribute('aria-invalid', 'true');
      countIn.focus();
      return;
    }
    const currentMax = activeTables().length;
    const toDeactivate = store.tables.filter((t) => t.is_active && t.table_number > n).length;
    if (toDeactivate) {
      const ok = await confirmDialog({
        title: `Deactivate ${plural(toDeactivate, 'table')}?`,
        message: `Tables ${n + 1}–${Math.max(...store.tables.filter((t) => t.is_active).map((t) => t.table_number))} will be hidden here and from printing. Nothing is deleted — raise the number again to bring them back.`,
        confirmLabel: 'Deactivate',
        icon: 'alert',
      });
      if (!ok) return;
    }
    setBusy(generateBtn, true);
    const rows = Array.from({ length: n }, (_, i) => ({ table_number: i + 1, is_active: true }));
    const up = await run(() => sb.from('tables').upsert(rows, { onConflict: 'table_number' }), { action: 'save your tables' });
    if (!up.error && toDeactivate) {
      await run(() => sb.from('tables').update({ is_active: false }).gt('table_number', n), { action: 'deactivate extra tables' });
    }
    setBusy(generateBtn, false);
    await reloadTables();
    if (!up.error) toast(n === currentMax && !toDeactivate ? `${plural(n, 'table')} ready` : `${plural(n, 'table')} ready — QR cards below`, { type: 'success', emoji: '🪑' });
  }

  addOneBtn.addEventListener('click', async () => {
    const next = Math.max(0, ...activeTables().map((t) => t.table_number)) + 1;
    setBusy(addOneBtn, true);
    const res = await run(() => sb.from('tables').upsert({ table_number: next, is_active: true }, { onConflict: 'table_number' }), { action: 'add a table' });
    setBusy(addOneBtn, false);
    if (res.error) return;
    await reloadTables();
    toast(`Table ${next} added`, { type: 'success', emoji: '🪑' });
  });

  const withProgress = async (btn, label, fn) => {
    const tables = activeTables();
    if (!tables.length) return;
    setBusy(btn, true);
    try {
      await fn(tables, (i, total) => { progress.textContent = `${label} ${i}/${total}…`; });
      toast(`${label} done — check your downloads`, { type: 'success' });
    } catch (err) {
      toast(`Couldn’t finish. ${err.message || 'Check your internet connection.'}`, { type: 'error' });
    }
    setBusy(btn, false);
    progress.textContent = plural(tables.length, 'active table');
  };
  zipBtn.addEventListener('click', () => withProgress(zipBtn, 'Making ZIP', downloadZip));
  pdfBtn.addEventListener('click', () => withProgress(pdfBtn, 'Making PDF', downloadPdf));

  // Only redraw when something printed on the cards actually changed.
  const cardSig = () => [store.settings?.shop_name, store.settings?.logo_url, menuBaseUrl()].join('|');
  let lastSig = cardSig();
  let shown = false;
  subscribe((e) => {
    if (!shown) return;
    if (e.type === 'tables' || e.type === 'loaded') { lastSig = cardSig(); renderGrid(); }
    if (e.type === 'settings' && cardSig() !== lastSig) { lastSig = cardSig(); renderGrid(); }
  });

  return {
    show() {
      paintWarning();
      if (!shown) { shown = true; renderGrid(); }
    },
  };
}

// Dashboard shell: session guard, tab routing, top bar and Realtime.
// Each tab module exports mount(panel) and owns its own rendering.

import { requireAdmin, logout } from './auth.js';
import { store, loadAll, startRealtime, subscribe, updateSettings, menuUrlFor } from './store.js';
import { $, $$, h, icon, toast, themeToggle, toggleSwitch, emptyState, clear } from '../lib/ui.js';
import * as overview from './overview.js';
import * as stock from './stock.js';
import * as menuEditor from './menu-editor.js';
import * as tablesQr from './tables-qr.js';
import * as settings from './settings.js';

const TABS = {
  overview: { module: overview, title: 'Overview' },
  stock: { module: stock, title: 'Stock' },
  menu: { module: menuEditor, title: 'Menu' },
  tables: { module: tablesQr, title: 'Tables & QR' },
  settings: { module: settings, title: 'Settings' },
};
const TAB_KEY = 'chaimenu:admin-tab';
const mounted = new Map(); // tab → controller
let current = null;

/* ---------------- Static icons in the HTML ---------------- */

function paintIcons() {
  for (const el of $$('[data-icon]')) {
    el.replaceWith(icon(el.dataset.icon, { size: el.closest('.bottom-nav') ? 22 : 20 }));
  }
}

/* ---------------- Routing ---------------- */

function tabFromHash() {
  const t = location.hash.replace('#', '');
  if (TABS[t]) return t;
  let saved = null;
  try { saved = localStorage.getItem(TAB_KEY); } catch { /* ignore */ }
  return TABS[saved] ? saved : 'stock'; // Stock is the counter's daily driver
}

function show(tab, { focus = false } = {}) {
  if (!TABS[tab]) tab = 'stock';
  for (const panel of $$('.tab-panel')) panel.hidden = panel.dataset.panel !== tab;
  for (const link of $$('[data-tab]')) {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const panel = $(`#tab-${tab}`);
  if (!mounted.has(tab)) mounted.set(tab, TABS[tab].module.mount(panel) || {});
  if (current && current !== tab) mounted.get(current)?.hide?.();
  mounted.get(tab).show?.();
  current = tab;
  document.title = `${TABS[tab].title} · ${store.settings?.shop_name || 'ChaiMenu'}`;
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  if (focus) {
    const heading = panel.querySelector('h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0 });
  }
}

/* ---------------- Top bar ---------------- */

let openSwitch;

function paintTopbar() {
  $('#shop-title').textContent = store.settings?.shop_name || 'Dashboard';
  $('#view-menu').href = menuUrlFor(null);
  if (openSwitch) openSwitch.setChecked(!!store.settings?.is_open);
}

function buildTopbar() {
  openSwitch = toggleSwitch({
    checked: !!store.settings?.is_open,
    onLabel: 'Open',
    offLabel: 'Closed',
    ariaLabel: 'Shop open for customers',
    className: 'open-switch',
    onChange: async (value) => {
      const res = await updateSettings({ is_open: value }, { action: value ? 'open the shop' : 'close the shop' });
      if (!res.error) toast(value ? 'Shop is open — customers see “Open”' : 'Shop marked closed', { type: value ? 'success' : 'info', emoji: value ? '🟢' : '🔴' });
    },
  });
  $('#open-switch-slot').appendChild(openSwitch);
  $('#theme-slot').appendChild(themeToggle());
  $('#logout').addEventListener('click', logout);
}

function setLive(status) {
  const dot = $('#live-dot');
  dot.className = `live-dot is-${status}`;
  dot.setAttribute('aria-label', status === 'live' ? 'Live: changes sync instantly' : status === 'offline' ? 'Offline: changes may not save' : 'Reconnecting…');
  dot.title = dot.getAttribute('aria-label');
  if (status === 'offline') toast('You’re offline. Changes won’t save until you reconnect.', { type: 'warning' });
}

/* ---------------- Boot ---------------- */

async function boot() {
  paintIcons();
  const user = await requireAdmin();
  store.user = user;
  $('#side-user').textContent = user.email || '';

  const { error } = await loadAll();
  $('#boot').remove();
  document.body.classList.remove('is-booting');
  if (error) {
    const view = $('#view');
    view.appendChild(emptyState({
      emoji: '😕',
      title: 'Couldn’t open the dashboard',
      message: 'Check your internet connection. If this keeps happening, make sure supabase/schema.sql has been run.',
      action: h('button', { type: 'button', class: 'btn btn-primary', onClick: () => location.reload() }, icon('refresh', { size: 18 }), 'Retry'),
    }));
    return;
  }

  buildTopbar();
  paintTopbar();
  subscribe((e) => { if (e.type === 'settings' || e.type === 'loaded') paintTopbar(); });

  window.addEventListener('hashchange', () => show(tabFromHash(), { focus: true }));
  show(tabFromHash());
  if (!location.hash) history.replaceState(null, '', `#${current}`);

  startRealtime(setLive);
}

boot().catch((err) => {
  console.error(err);
  const bootEl = $('#boot');
  if (bootEl) clear(bootEl).appendChild(emptyState({ emoji: '😕', title: 'Something went wrong', message: String(err.message || err) }));
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

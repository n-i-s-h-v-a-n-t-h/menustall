// Customer menu bootstrap: one small state store, first paint from cache,
// one network query for the menu, then live updates.

import { sb, fetchMenu, fetchSettings, fetchPopular, logScan, logView, clientProblem } from '../lib/supabase.js';
import { $, h, clear, toast, themeToggle, debounce, emptyState, icon } from '../lib/ui.js';
import {
  renderHeader, renderStatus, renderAnnouncement, renderMenu, syncSection, syncAllSections,
  applyFilters, renderRails, openItemSheet, refreshOpenSheet, setLiveStatus, updateScrollOffset, itemState,
} from './render.js';
import { createPicks } from './picks.js';
import { connectRealtime } from './realtime.js';

const CACHE_KEY = 'chaimenu:menu-cache:v1';

/* ---------------- State ---------------- */

const state = {
  settings: null,
  categories: [],        // [{ id, name, emoji, sort_order }]
  items: new Map(),      // id → item row
  popular: [],           // item ids, most viewed first
  table: parseTable(),
  filters: { veg: false, available: false, best: false },
  query: '',
  loaded: false,
};

function parseTable() {
  const raw = new URLSearchParams(location.search).get('table');
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && n <= 10000 && String(n) === String(raw).trim() ? n : null;
}

function setMenu(rows) {
  state.categories = rows.map(({ menu_items: _items, ...cat }) => cat);
  state.items = new Map();
  for (const cat of rows) for (const item of cat.menu_items || []) state.items.set(item.id, item);
}

const currency = () => state.settings?.currency_symbol || '₹';
const categoryOf = (item) => state.categories.find((c) => c.id === item?.category_id);

/* ---------------- Handlers shared with render ---------------- */

let picks;

const handlers = {
  pickQty: (id) => (picks ? picks.qty(id) : 0),
  onOpen: (item) => {
    const current = state.items.get(item.id) || item;
    openItemSheet(current, state, handlers);
    logView(current.id);
  },
  onAdd: (item, btn) => {
    picks.add(item, 1);
    if (btn) {
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
  },
  onAddQty: (item, qty) => {
    picks.add(item, qty);
    toast(`Added ${qty} × ${item.name}`, {
      type: 'success',
      emoji: categoryOf(item)?.emoji,
      action: { label: 'View', onClick: () => picks.open() },
    });
  },
  onClearFilters: () => {
    state.query = '';
    state.filters = { veg: false, available: false, best: false };
    $('#search').value = '';
    paintFilterChips();
    applyFilters(state, handlers);
  },
};

/* ---------------- Rendering ---------------- */

function renderAll() {
  renderHeader(state.settings, state.table);
  renderAnnouncement(state.settings);
  renderMenu(state, handlers);
  renderRails(state, handlers);
  applyFilters(state, handlers);
  $('#toolbar').hidden = state.categories.length === 0;
  $('#filters').hidden = state.categories.length === 0;
  document.body.classList.remove('is-loading');
}

function showFatal(message, retry) {
  document.body.classList.remove('is-loading');
  const sections = $('#sections');
  sections.hidden = false;
  clear(sections).appendChild(emptyState({
    emoji: '😕',
    title: 'Couldn’t load the menu',
    message,
    action: retry ? h('button', { type: 'button', class: 'btn btn-primary', onClick: retry }, icon('refresh', { size: 18 }), 'Retry') : null,
  }));
  $('#toolbar').hidden = true;
  $('#filters').hidden = true;
}

/* ---------------- Data ---------------- */

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached && Array.isArray(cached.menu) ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(menu, settings) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ menu, settings, at: Date.now() })); } catch { /* quota */ }
}

async function load({ quiet = false } = {}) {
  const [menuRes, settingsRes] = await Promise.all([
    fetchMenu({ silent: true }),
    fetchSettings({ silent: true }),
  ]);

  if (menuRes.error) {
    if (state.loaded) {
      if (!quiet) toast('Couldn’t refresh the menu. Showing the last version.', { type: 'warning', action: { label: 'Retry', onClick: () => load() } });
      return;
    }
    const problem = clientProblem();
    showFatal(problem || (navigator.onLine ? 'Something went wrong on our side. Please try again.' : 'You’re offline. Check your connection and try again.'), problem ? null : () => {
      document.body.classList.add('is-loading');
      load();
    });
    return;
  }

  if (settingsRes.data) state.settings = settingsRes.data;
  setMenu(menuRes.data || []);
  state.loaded = true;
  writeCache(menuRes.data || [], state.settings);
  renderAll();
  loadPopular();
  picks.refresh();
}

async function loadPopular() {
  const res = await fetchPopular();
  if (res.data) {
    state.popular = res.data.map((r) => r.item_id);
    renderRails(state, handlers);
  }
}

/* ---------------- Live updates ---------------- */

const reloadMenu = debounce(() => load({ quiet: true }), 300);

function onItem(row) {
  const prev = state.items.get(row.id);
  const known = state.categories.some((c) => c.id === row.category_id);

  if (!row.is_visible || !known) {
    if (prev) {
      state.items.delete(row.id);
      syncSection(state, handlers, prev.category_id);
    }
    afterItemChange();
    return;
  }

  state.items.set(row.id, row);
  const animate = new Set([row.id]);
  syncSection(state, handlers, row.category_id, { animateIds: animate });
  if (prev && prev.category_id !== row.category_id) syncSection(state, handlers, prev.category_id);

  // Friendly heads-up when availability flips.
  if (prev && prev.in_stock !== row.in_stock) {
    const emoji = categoryOf(row)?.emoji;
    if (row.in_stock) toast(`${row.name} is back!`, { type: 'success', emoji: emoji || '🎉' });
    else toast(`${row.name} just sold out`, { type: 'warning', emoji: '😔' });
  }

  refreshOpenSheet(row);
  afterItemChange();
}

function onItemDelete(id) {
  const prev = state.items.get(id);
  if (!prev) return;
  state.items.delete(id);
  syncSection(state, handlers, prev.category_id);
  afterItemChange();
}

function afterItemChange() {
  renderRails(state, handlers);
  applyFilters(state, handlers);
  picks.refresh();
  writeCache(serializeMenu(), state.settings);
}

function serializeMenu() {
  return state.categories.map((c) => ({ ...c, menu_items: [...state.items.values()].filter((i) => i.category_id === c.id) }));
}

function onSettings(row) {
  const prevCurrency = currency();
  state.settings = row;
  renderHeader(state.settings, state.table);
  renderAnnouncement(state.settings);
  if (prevCurrency !== currency()) {
    syncAllSections(state, handlers);
    renderRails(state, handlers);
    picks.refresh();
  }
  writeCache(serializeMenu(), state.settings);
}

/* ---------------- Toolbar: search + filters ---------------- */

function paintFilterChips() {
  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.setAttribute('aria-pressed', state.filters[btn.dataset.filter] ? 'true' : 'false');
  }
}

function wireToolbar() {
  const search = $('#search');
  const clearBtn = $('#search-clear');
  const runSearch = debounce(() => applyFilters(state, handlers), 120);
  search.addEventListener('input', () => {
    state.query = search.value;
    clearBtn.hidden = !search.value;
    runSearch();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.preventDefault();
      search.value = '';
      state.query = '';
      clearBtn.hidden = true;
      applyFilters(state, handlers);
    }
  });
  clearBtn.addEventListener('click', () => {
    search.value = '';
    state.query = '';
    clearBtn.hidden = true;
    applyFilters(state, handlers);
    search.focus();
  });

  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filter;
      state.filters[key] = !state.filters[key];
      paintFilterChips();
      applyFilters(state, handlers);
    });
  }

  window.addEventListener('resize', debounce(updateScrollOffset, 150));
}

/* ---------------- Clock: time windows, "Fresh" expiry, open status ---------------- */

function tick() {
  if (!state.loaded) return;
  renderStatus(state.settings);
  syncAllSections(state, handlers); // only re-renders cards whose state changed
  renderRails(state, handlers);
  applyFilters(state, handlers);
  picks.refresh();
}

/* ---------------- Boot ---------------- */

function boot() {
  $('#theme-slot').appendChild(themeToggle('btn btn-ghost btn-icon hero-btn'));

  picks = createPicks({
    getItem: (id) => state.items.get(id),
    getCurrency: currency,
    table: state.table,
    onChange: (id) => {
      const item = id ? state.items.get(id) : null;
      if (item) syncSection(state, handlers, item.category_id);
      else syncAllSections(state, handlers);
      applyFilters(state, handlers);
    },
  });

  wireToolbar();

  // Instant first paint from the last visit, then refresh from the network.
  const cached = readCache();
  if (cached) {
    state.settings = cached.settings;
    setMenu(cached.menu);
    state.loaded = true;
    renderAll();
    picks.refresh();
  }

  load();
  logScan(state.table);

  if (sb) {
    connectRealtime({
      onItem,
      onItemDelete,
      onCategories: reloadMenu,
      onSettings,
      onStatus: setLiveStatus,
      onResync: () => load({ quiet: true }),
    });
  }

  setInterval(tick, 60 * 1000);
}

boot();

// Keep `itemState` reachable for debugging in the console without globals soup.
export { state, itemState };

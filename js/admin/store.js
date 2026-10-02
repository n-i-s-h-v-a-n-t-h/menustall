// The dashboard's single state store. Every tab reads from here and writes
// through here, so two staff phones stay in sync via Realtime and an
// optimistic change can always be rolled back.

import { sb, run, ITEM_COLUMNS } from '../lib/supabase.js';

export const store = {
  user: null,
  settings: null,
  categories: [], // all, ordered
  items: [],      // all, ordered
  tables: [],     // all, by number
  loaded: false,
};

const listeners = new Set();

/** Subscribe to store events: { type: 'item'|'items'|'categories'|'settings'|'tables'|'stock_event', ... } */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) { console.error(err); } // one broken tab never breaks the others
  }
}

/* ---------------- Selectors ---------------- */

export const getItem = (id) => store.items.find((i) => i.id === id);
export const getCategory = (id) => store.categories.find((c) => c.id === id);
export const byOrder = (a, b) => a.sort_order - b.sort_order || String(a.name).localeCompare(String(b.name));
export const itemsIn = (catId) => store.items.filter((i) => (i.category_id || null) === (catId || null)).sort(byOrder);
export const currency = () => store.settings?.currency_symbol || '₹';
export const emojiFor = (item) => getCategory(item?.category_id)?.emoji || '🍽️';

/** Root URL of the customer menu (folder containing index.html). */
export function menuBaseUrl() {
  const fromSettings = (store.settings?.base_url || '').trim().replace(/\/+$/, '').replace(/\/index\.html$/, '');
  if (fromSettings) return fromSettings;
  return new URL('../', location.href).href.replace(/\/+$/, '');
}

export const menuUrlFor = (tableNumber) => `${menuBaseUrl()}/index.html${tableNumber ? `?table=${tableNumber}` : ''}`;

export function isLocalUrl(url) {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === 'file:' || hostname === 'localhost' || hostname === '0.0.0.0' || /^127\./.test(hostname) || hostname.endsWith('.local') || /^(10|192\.168)\./.test(hostname);
  } catch {
    return true;
  }
}

/* ---------------- Loading ---------------- */

export async function loadAll() {
  const [settings, categories, items, tables] = await Promise.all([
    run(() => sb.from('shop_settings').select('*').eq('id', 1).maybeSingle(), { action: 'load shop settings' }),
    run(() => sb.from('categories').select('*').order('sort_order').order('name'), { action: 'load categories' }),
    run(() => sb.from('menu_items').select(ITEM_COLUMNS).order('sort_order').order('name'), { action: 'load menu items' }),
    run(() => sb.from('tables').select('*').order('table_number'), { action: 'load tables' }),
  ]);
  const error = settings.error || categories.error || items.error || tables.error;
  if (!error) {
    store.settings = settings.data || { id: 1, shop_name: 'My Tea Stall', currency_symbol: '₹', is_open: true };
    store.categories = categories.data || [];
    store.items = items.data || [];
    store.tables = tables.data || [];
    store.loaded = true;
    emit({ type: 'loaded' });
  }
  return { error };
}

export async function reloadTables() {
  const res = await run(() => sb.from('tables').select('*').order('table_number'), { action: 'load tables' });
  if (res.data) {
    store.tables = res.data;
    emit({ type: 'tables' });
  }
  return res;
}

/* ---------------- Local mutations (no network) ---------------- */

export function putItem(row) {
  const i = store.items.findIndex((x) => x.id === row.id);
  const prev = i === -1 ? null : store.items[i];
  if (i === -1) store.items.push(row);
  else store.items[i] = { ...prev, ...row };
  emit({ type: 'item', item: getItem(row.id), prev });
}

export function dropItem(id) {
  const prev = getItem(id);
  store.items = store.items.filter((x) => x.id !== id);
  if (prev) emit({ type: 'item_removed', item: prev });
}

export function putCategory(row) {
  const i = store.categories.findIndex((x) => x.id === row.id);
  if (i === -1) store.categories.push(row);
  else store.categories[i] = { ...store.categories[i], ...row };
  store.categories.sort(byOrder);
  emit({ type: 'categories' });
}

export function dropCategory(id) {
  store.categories = store.categories.filter((c) => c.id !== id);
  // Mirrors "on delete set null" in the database.
  store.items = store.items.map((i) => (i.category_id === id ? { ...i, category_id: null } : i));
  emit({ type: 'categories' });
  emit({ type: 'items' });
}

/* ---------------- Writes ---------------- */

// While a write for an item is in flight we ignore its Realtime echoes,
// then apply the row the server returns — no flicker on quick taps.
const pending = new Map();
const busy = (id, delta) => {
  const n = (pending.get(id) || 0) + delta;
  if (n <= 0) pending.delete(id);
  else pending.set(id, n);
};

/**
 * Optimistically patch an item, then save. Rolls back on failure.
 * Returns { data, error }.
 */
export async function updateItem(id, patch, { action = 'save the change', retry, silent } = {}) {
  const before = getItem(id);
  if (!before) return { error: new Error('Item not found') };
  const snapshot = { ...before };
  putItem({ ...before, ...patch });
  busy(id, 1);
  const res = await run(
    () => sb.from('menu_items').update(patch).eq('id', id).select(ITEM_COLUMNS).single(),
    { action, retry, silent },
  );
  busy(id, -1);
  if (res.error) {
    putItem(snapshot); // roll back
  } else if (res.data && !pending.has(id)) {
    putItem(res.data);
  }
  return res;
}

/** Put an item's stock state back exactly (used by Undo). */
export async function restoreStock(snapshot, { action = 'undo that' } = {}) {
  putItem({ ...getItem(snapshot.id), ...snapshot });
  busy(snapshot.id, 1);
  const res = await run(() => sb.rpc('restore_stock', {
    p_item: snapshot.id,
    p_in_stock: snapshot.in_stock,
    p_stock_qty: snapshot.stock_qty,
    p_last_restocked_at: snapshot.last_restocked_at,
    p_last_stockout_at: snapshot.last_stockout_at,
  }), { action });
  busy(snapshot.id, -1);
  if (!res.error) {
    const fresh = await run(() => sb.from('menu_items').select(ITEM_COLUMNS).eq('id', snapshot.id).single(), { silent: true });
    if (fresh.data) putItem(fresh.data);
  }
  return res;
}

/** Optimistic bulk stock change. `ids` empty = nothing to do. */
export async function setStockBulk(ids, inStock, { action = 'update stock' } = {}) {
  if (!ids.length) return { data: [], error: null, snapshots: [] };
  const snapshots = ids.map((id) => stockSnapshot(getItem(id))).filter(Boolean);
  for (const s of snapshots) putItem({ ...getItem(s.id), in_stock: inStock });
  ids.forEach((id) => busy(id, 1));
  const res = await run(
    () => sb.from('menu_items').update({ in_stock: inStock }).in('id', ids).select(ITEM_COLUMNS),
    { action },
  );
  ids.forEach((id) => busy(id, -1));
  if (res.error) {
    for (const s of snapshots) putItem({ ...getItem(s.id), ...s });
  } else {
    for (const row of res.data || []) putItem(row);
  }
  return { ...res, snapshots };
}

export function stockSnapshot(item) {
  if (!item) return null;
  return {
    id: item.id,
    in_stock: item.in_stock,
    stock_qty: item.stock_qty,
    last_restocked_at: item.last_restocked_at,
    last_stockout_at: item.last_stockout_at,
  };
}

export async function updateSettings(patch, { action = 'save settings' } = {}) {
  const before = { ...store.settings };
  store.settings = { ...store.settings, ...patch };
  emit({ type: 'settings' });
  // Upsert: works even if the shop row was never created.
  const res = await run(() => sb.from('shop_settings').upsert({ id: 1, ...patch }, { onConflict: 'id' }).select('*').single(), { action });
  if (res.error) {
    store.settings = before;
  } else if (res.data) {
    store.settings = res.data;
  }
  emit({ type: 'settings' });
  return res;
}

/* ---------------- Realtime ---------------- */

let channel = null;

export function startRealtime(onStatus = () => {}) {
  if (!sb || channel) return;
  let wasDown = false;
  channel = sb
    .channel('admin-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, (p) => {
      if (p.eventType === 'DELETE') { if (p.old?.id) dropItem(p.old.id); return; }
      if (pending.has(p.new.id)) return;
      putItem(p.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, (p) => {
      if (p.eventType === 'DELETE') {
        if (p.old?.id && getCategory(p.old.id)) dropCategory(p.old.id);
      } else {
        putCategory(p.new);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_settings' }, (p) => {
      if (p.new?.id) {
        store.settings = { ...store.settings, ...p.new };
        emit({ type: 'settings' });
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_events' }, (p) => {
      emit({ type: 'stock_event', event: p.new });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onStatus('live');
        if (wasDown) {
          wasDown = false;
          loadAll(); // catch up on anything missed while offline
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        wasDown = true;
        onStatus('reconnecting');
      }
    });

  window.addEventListener('offline', () => { wasDown = true; onStatus('offline'); });
}

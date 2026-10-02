// Stock tab — the screen the owner uses all day. One tap flips an item,
// the UI changes instantly, saving happens in the background, failures
// roll back with a Retry, and every change offers Undo for 5 seconds.

import {
  store, subscribe, getItem, getCategory, itemsIn, currency, emojiFor,
  updateItem, restoreStock, setStockBulk, stockSnapshot, putItem,
} from './store.js';
import { sb, run, ITEM_COLUMNS } from '../lib/supabase.js';
import {
  h, icon, clear, toast, confirmDialog, toggleSwitch, debounce, openSheet, button, emptyState, setBusy,
} from '../lib/ui.js';
import { formatPrice, plural, isLowStock } from '../lib/format.js';

const UNDO_MS = 5000;

export function mount(panel) {
  const ui = { query: '', filter: 'all' };
  const rowEls = new Map();   // item id → row element
  const groupEls = new Map(); // category id (or 'none') → { group, list, header }

  /* ---------------- Static layout ---------------- */

  const search = h('input', { class: 'input', type: 'search', id: 'stock-search', placeholder: 'Search items…', autocomplete: 'off', enterkeyhint: 'search' });
  const segButtons = {
    all: h('button', { type: 'button', 'aria-pressed': 'true' }, 'All', h('span', { class: 'count' })),
    in: h('button', { type: 'button', 'aria-pressed': 'false' }, 'In stock', h('span', { class: 'count' })),
    out: h('button', { type: 'button', 'aria-pressed': 'false' }, 'Sold out', h('span', { class: 'count' })),
  };
  const markAll = button('Mark all in stock', { icon: 'check', variant: 'success-soft', size: 'sm' });
  const list = h('div', { class: 'stock-list' });
  const empty = h('div', { hidden: true });

  panel.append(
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'panel-title display', id: 'h-stock' }, 'Stock'),
        h('p', { class: 'panel-sub' }, 'Tap the switch when something runs out. Customers see it in about 2 seconds.'),
      ),
    ),
    h('div', { class: 'stock-toolbar' },
      h('div', { class: 'input-wrap stock-search' },
        icon('search', { size: 18 }),
        h('label', { class: 'sr-only', for: 'stock-search' }, 'Search items'),
        search,
      ),
      h('div', { class: 'stock-toolbar-row' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Show' }, segButtons.all, segButtons.in, segButtons.out),
        markAll,
      ),
    ),
    list,
    empty,
  );

  // Category headers stick right under the toolbar, whatever its height.
  const toolbarEl = panel.querySelector('.stock-toolbar');
  const topbarEl = document.querySelector('.topbar');
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      panel.style.setProperty('--stock-toolbar-h', `${toolbarEl.offsetHeight}px`);
      if (topbarEl) document.documentElement.style.setProperty('--topbar-h', `${topbarEl.offsetHeight}px`);
    }).observe(toolbarEl);
  }

  search.addEventListener('input', debounce(() => { ui.query = search.value.trim().toLowerCase(); applyFilter(); }, 100));
  for (const [key, btn] of Object.entries(segButtons)) {
    btn.addEventListener('click', () => {
      ui.filter = key;
      for (const [k, b] of Object.entries(segButtons)) b.setAttribute('aria-pressed', k === key ? 'true' : 'false');
      applyFilter();
    });
  }
  markAll.addEventListener('click', markAllInStock);

  /* ---------------- Rows ---------------- */

  function thumb(item) {
    if (item.image_url) {
      const img = h('img', { src: item.image_url, alt: '', loading: 'lazy', width: 48, height: 48 });
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'thumb-emoji' }, emojiFor(item))));
      return h('div', { class: 'thumb' }, img);
    }
    return h('div', { class: 'thumb' }, h('span', { class: 'thumb-emoji', 'aria-hidden': 'true' }, emojiFor(item)));
  }

  function createRow(item) {
    const sw = toggleSwitch({
      checked: item.in_stock,
      onLabel: 'In stock',
      offLabel: 'Sold out',
      ariaLabel: `${item.name} in stock`,
      className: 'stock-switch',
      onChange: (value) => setStock(item.id, value),
    });

    let qtyControls = null;
    if (item.track_qty) {
      const qty = item.stock_qty ?? 0;
      const dec = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `One less ${item.name}`, disabled: qty <= 0, onClick: () => bumpQty(item.id, -1) }, icon('minus', { size: 18 }));
      const inc = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `One more ${item.name}`, onClick: () => bumpQty(item.id, 1) }, icon('plus', { size: 18 }));
      const val = h('button', { type: 'button', class: 'qty-value', 'aria-label': `${qty} ${item.name} left. Tap to type a number`, onClick: () => editQty(item.id) }, String(qty));
      qtyControls = h('div', { class: 'stepper stock-stepper', role: 'group', 'aria-label': `Quantity of ${item.name}` }, dec, val, inc);
    }

    const meta = [formatPrice(item.price, currency())];
    const low = isLowStock(item);
    const row = h('div', { class: `stock-row ${item.in_stock ? '' : 'is-out'}`, dataset: { id: item.id } },
      thumb(item),
      h('div', { class: 'stock-info' },
        h('p', { class: 'stock-name' },
          item.name,
          !item.is_visible ? h('span', { class: 'badge', title: 'Hidden from customers' }, icon('eyeOff', { size: 12 }), 'Hidden') : null,
        ),
        h('p', { class: 'stock-meta' },
          h('span', { class: 'tabular' }, meta.join(' · ')),
          low ? h('span', { class: 'badge badge-warning' }, 'Low') : null,
          item.track_qty && item.in_stock && item.stock_qty === 0 ? h('span', { class: 'badge' }, 'Qty 0') : null,
        ),
        qtyControls,
      ),
      sw,
    );
    return row;
  }

  function replaceRow(item) {
    const old = rowEls.get(item.id);
    if (!old) return false;
    const active = document.activeElement;
    const focusSel = old.contains(active)
      ? (active.classList.contains('stock-switch') ? '.stock-switch' : active.getAttribute('aria-label') ? `[aria-label="${CSS.escape(active.getAttribute('aria-label'))}"]` : null)
      : null;
    const row = createRow(item);
    if (old.classList.contains('is-out') !== row.classList.contains('is-out')) row.classList.add('is-flipped');
    old.replaceWith(row);
    rowEls.set(item.id, row);
    if (focusSel) {
      const target = row.querySelector(focusSel) || row.querySelector('.stock-switch');
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else row.querySelector('.stock-switch').focus({ preventScroll: true });
    }
    return true;
  }

  /* ---------------- Groups ---------------- */

  function renderAll() {
    clear(list);
    rowEls.clear();
    groupEls.clear();

    const groups = store.categories.map((c) => ({ id: c.id, cat: c }));
    if (store.items.some((i) => !i.category_id || !getCategory(i.category_id))) groups.push({ id: 'none', cat: null });

    for (const { id, cat } of groups) {
      const items = id === 'none'
        ? store.items.filter((i) => !i.category_id || !getCategory(i.category_id))
        : itemsIn(id);
      if (!items.length) continue;

      const count = h('span', { class: 'group-count tabular' });
      const outBtn = h('button', { type: 'button', class: 'btn btn-danger-soft btn-sm', onClick: () => bulkGroup(id, false) }, 'Sold out');
      const inBtn = h('button', { type: 'button', class: 'btn btn-success-soft btn-sm', onClick: () => bulkGroup(id, true) }, 'Restock');
      const name = cat ? cat.name : 'Uncategorised';
      outBtn.setAttribute('aria-label', `Mark all ${name} sold out`);
      inBtn.setAttribute('aria-label', `Restock all ${name}`);
      const header = h('div', { class: 'group-head' },
        h('h3', { class: 'group-title' },
          h('span', { 'aria-hidden': 'true' }, cat?.emoji || '📦'),
          h('span', {}, name),
          count,
        ),
        h('div', { class: 'group-actions' }, outBtn, inBtn),
      );
      const glist = h('div', { class: 'group-list' });
      for (const item of items) {
        const row = createRow(item);
        rowEls.set(item.id, row);
        glist.appendChild(row);
      }
      const group = h('section', { class: 'stock-group', 'aria-label': name }, header, glist);
      list.appendChild(group);
      groupEls.set(id, { group, list: glist, header, count, cat });
    }

    if (!store.items.length) {
      empty.hidden = false;
      clear(empty).appendChild(emptyState({
        emoji: '📦',
        title: 'No items yet',
        message: 'Add your menu items in the Menu tab, then manage stock here.',
        action: h('a', { class: 'btn btn-primary', href: '#menu' }, icon('plus', { size: 18 }), 'Add menu items'),
      }));
    } else {
      empty.hidden = true;
    }
    applyFilter();
  }

  function applyFilter() {
    let all = 0; let inCount = 0; let outCount = 0; let shown = 0;
    for (const [id, g] of groupEls) {
      let visible = 0; let groupIn = 0; let groupTotal = 0;
      for (const row of g.list.children) {
        const item = getItem(row.dataset.id);
        if (!item) continue;
        all++; groupTotal++;
        if (item.in_stock) { inCount++; groupIn++; } else outCount++;
        let ok = true;
        if (ui.filter === 'in' && !item.in_stock) ok = false;
        if (ui.filter === 'out' && item.in_stock) ok = false;
        if (ok && ui.query && !item.name.toLowerCase().includes(ui.query)) ok = false;
        row.hidden = !ok;
        if (ok) visible++;
      }
      g.count.textContent = `${groupIn}/${groupTotal} in stock`;
      g.group.hidden = visible === 0;
      shown += visible;
      void id;
    }
    segButtons.all.querySelector('.count').textContent = all;
    segButtons.in.querySelector('.count').textContent = inCount;
    segButtons.out.querySelector('.count').textContent = outCount;
    markAll.disabled = outCount === 0;

    if (store.items.length && shown === 0) {
      empty.hidden = false;
      clear(empty).appendChild(emptyState({
        emoji: ui.filter === 'out' && !ui.query ? '🎉' : '🔍',
        title: ui.filter === 'out' && !ui.query ? 'Nothing is sold out' : 'No matching items',
        message: ui.filter === 'out' && !ui.query ? 'Everything on the menu is available.' : 'Try a different search or filter.',
      }));
    } else if (store.items.length) {
      empty.hidden = true;
    }
  }

  /* ---------------- Actions ---------------- */

  async function setStock(id, value) {
    const item = getItem(id);
    if (!item) return;
    const snap = stockSnapshot(item);
    const res = await updateItem(id, { in_stock: value }, {
      action: value ? `restock ${item.name}` : `mark ${item.name} sold out`,
      retry: () => setStock(id, value),
    });
    if (res.error) return;
    toast(value ? `${item.name} is back in stock` : `${item.name} marked sold out`, {
      type: value ? 'success' : 'info',
      emoji: value ? emojiFor(item) : '🚫',
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undo([snap]) },
    });
  }

  async function undo(snapshots) {
    const results = await Promise.all(snapshots.map((s) => restoreStock(s)));
    if (results.every((r) => !r.error)) toast('Undone', { type: 'success', duration: 1800 });
  }

  async function bulkGroup(groupId, value) {
    const items = groupId === 'none'
      ? store.items.filter((i) => !i.category_id || !getCategory(i.category_id))
      : itemsIn(groupId);
    const ids = items.filter((i) => i.in_stock !== value).map((i) => i.id);
    const name = groupId === 'none' ? 'Uncategorised' : getCategory(groupId)?.name;
    if (!ids.length) {
      toast(value ? `All ${name} items are already in stock` : `All ${name} items are already sold out`, { type: 'info' });
      return;
    }
    const res = await setStockBulk(ids, value, { action: 'update the whole category' });
    if (res.error) return;
    toast(value ? `${plural(ids.length, 'item')} in ${name} restocked` : `${plural(ids.length, 'item')} in ${name} sold out`, {
      type: value ? 'success' : 'info',
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undo(res.snapshots) },
    });
  }

  async function markAllInStock() {
    const ids = store.items.filter((i) => !i.in_stock).map((i) => i.id);
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: 'Mark everything in stock?',
      message: `${plural(ids.length, 'sold-out item')} will show as available to customers right away.`,
      confirmLabel: 'Mark all in stock',
      icon: 'check',
    });
    if (!ok) return;
    setBusy(markAll, true);
    const res = await setStockBulk(ids, true, { action: 'mark everything in stock' });
    setBusy(markAll, false);
    if (res.error) return;
    applyFilter();
    toast(`${plural(ids.length, 'item')} back in stock`, {
      type: 'success',
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undo(res.snapshots) },
    });
  }

  /* ---------------- Quantity ---------------- */

  // Taps are applied locally at once and saved once the owner pauses,
  // so tapping + five times sends one request, not five.
  const qtyDrafts = new Map(); // id → { original, timer }

  function localQty(id, next) {
    const item = getItem(id);
    const value = Math.max(0, Math.min(9999, next));
    const draft = qtyDrafts.get(id) || { original: stockSnapshot(item), timer: null };
    qtyDrafts.set(id, draft);
    // Mirror the database rules so the switch reacts immediately.
    let inStock = item.in_stock;
    if (value === 0) inStock = false;
    else if ((item.stock_qty ?? 0) === 0 && !item.in_stock) inStock = true;
    putItem({ ...item, stock_qty: value, in_stock: inStock });
    clearTimeout(draft.timer);
    draft.timer = setTimeout(() => saveQty(id), 600);
  }

  function bumpQty(id, delta) {
    const item = getItem(id);
    if (item) localQty(id, (item.stock_qty ?? 0) + delta);
  }

  async function saveQty(id) {
    const draft = qtyDrafts.get(id);
    qtyDrafts.delete(id);
    const item = getItem(id);
    if (!draft || !item) return;
    const res = await run(
      () => sb.from('menu_items').update({ stock_qty: item.stock_qty }).eq('id', id).select(ITEM_COLUMNS).single(),
      { action: `save the quantity for ${item.name}`, retry: () => { localQty(id, item.stock_qty); } },
    );
    if (res.error) {
      putItem({ ...getItem(id), ...draft.original });
      return;
    }
    if (!qtyDrafts.has(id)) putItem(res.data);
    if (draft.original.in_stock && !res.data.in_stock) {
      toast(`${item.name} hit 0 — marked sold out`, {
        type: 'info',
        emoji: '🚫',
        duration: UNDO_MS,
        action: { label: 'Undo', onClick: () => undo([draft.original]) },
      });
    }
  }

  function editQty(id) {
    const item = getItem(id);
    if (!item) return;
    const input = h('input', { class: 'input qty-input', type: 'number', id: 'qty-input', min: 0, max: 9999, inputmode: 'numeric', value: String(item.stock_qty ?? 0) });
    const quick = [10, 20, 50].map((n) => h('button', { type: 'button', class: 'chip', onClick: () => { input.value = String((Number(input.value) || 0) + n); input.focus(); } }, `+${n}`));
    const save = button('Save quantity', { variant: 'primary', size: 'lg', className: 'btn-block', type: 'submit' });
    const form = h('form', { class: 'qty-form', novalidate: true },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'qty-input' }, `How many ${item.name} are left?`),
        input,
      ),
      h('div', { class: 'qty-quick' }, quick),
    );
    const sheet = openSheet({ title: 'Set quantity', content: form, footer: save, initialFocus: input });
    const submit = (e) => {
      e?.preventDefault();
      const n = Number.parseInt(input.value, 10);
      if (!Number.isInteger(n) || n < 0) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      localQty(id, n);
      clearTimeout(qtyDrafts.get(id)?.timer);
      saveQty(id);
      sheet.close();
    };
    form.addEventListener('submit', submit);
    save.addEventListener('click', submit);
  }

  /* ---------------- Store events ---------------- */

  subscribe((e) => {
    if (e.type === 'item') {
      const row = rowEls.get(e.item.id);
      const sameGroup = row && row.parentElement === groupEls.get(e.item.category_id && getCategory(e.item.category_id) ? e.item.category_id : 'none')?.list;
      const reordered = e.prev && (e.prev.sort_order !== e.item.sort_order || e.prev.track_qty !== e.item.track_qty);
      if (row && sameGroup && !reordered && replaceRow(e.item)) applyFilter();
      else renderAll();
    } else if (['items', 'categories', 'loaded', 'settings', 'item_removed'].includes(e.type)) {
      renderAll();
    }
  });

  renderAll();

  return {
    show() { applyFilter(); },
  };
}

// Menu tab: categories and items — add, edit, reorder, hide, duplicate,
// delete — plus the item editor with photo upload and a live preview of
// exactly how the card looks to customers.

import {
  store, subscribe, getItem, getCategory, itemsIn, byOrder, currency, emojiFor,
  putItem, dropItem, putCategory, dropCategory, updateItem, loadAll,
} from './store.js';
import { sb, run, ITEM_COLUMNS, uploadImage, deleteImageByUrl } from '../lib/supabase.js';
import {
  h, icon, clear, toast, confirmDialog, openSheet, button, emptyState, makeSortable, setBusy, debounce,
} from '../lib/ui.js';
import { formatPrice, plural, toInputTime, TAG_LABELS } from '../lib/format.js';
import { createItemCard } from '../menu/render.js';
import { pickImageFile, cropImage } from './image-tools.js';

const EMOJIS = ['☕', '🫖', '🍵', '🧋', '🥤', '🧃', '🥛', '🍋', '🥟', '🍘', '🌯', '🥪', '🍞', '🥐', '🍪', '🍩', '🧁', '🍰', '🍮', '🍫', '🍯', '🥜', '🌶️', '🔥', '🍳', '🥚', '🍗', '🍟', '🍕', '🍔', '🍜', '🍛', '🍚', '🥗', '🍌', '🍉', '🥥', '🌽', '🧂', '⭐'];

export function mount(panel) {
  const ui = { view: 'items', query: '' };

  /* ---------------- Layout ---------------- */

  const tabItems = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Items');
  const tabCats = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Categories');
  const addBtn = button('Add item', { icon: 'plus', variant: 'primary' });
  const search = h('input', { class: 'input', type: 'search', id: 'menu-search', placeholder: 'Search items…', autocomplete: 'off' });
  const searchWrap = h('div', { class: 'input-wrap menu-search' }, icon('search', { size: 18 }), h('label', { class: 'sr-only', for: 'menu-search' }, 'Search items'), search);
  const itemsView = h('div', { class: 'editor-groups' });
  const catsView = h('div', { class: 'cat-view', hidden: true });

  panel.append(
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'panel-title display', id: 'h-menu' }, 'Menu'),
        h('p', { class: 'panel-sub' }, 'Add, edit and arrange what customers see. Drag ⠿ to reorder.'),
      ),
      addBtn,
    ),
    h('div', { class: 'menu-toolbar' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Edit' }, tabItems, tabCats),
      searchWrap,
    ),
    itemsView,
    catsView,
  );

  const setView = (view) => {
    ui.view = view;
    tabItems.setAttribute('aria-pressed', view === 'items' ? 'true' : 'false');
    tabCats.setAttribute('aria-pressed', view === 'cats' ? 'true' : 'false');
    itemsView.hidden = view !== 'items';
    searchWrap.hidden = view !== 'items';
    catsView.hidden = view !== 'cats';
    addBtn.querySelector('.btn-label').textContent = view === 'items' ? 'Add item' : 'Add category';
    render();
  };
  tabItems.addEventListener('click', () => setView('items'));
  tabCats.addEventListener('click', () => setView('cats'));
  addBtn.addEventListener('click', () => (ui.view === 'items' ? openItemEditor(null) : openCategoryEditor(null)));
  search.addEventListener('input', debounce(() => { ui.query = search.value.trim().toLowerCase(); renderItems(); }, 120));

  /* ---------------- Ordering helpers ---------------- */

  // Persist a new order: only rows whose position changed are written.
  async function saveOrder(table, ids) {
    const rows = table === 'categories' ? store.categories : store.items;
    const changes = [];
    ids.forEach((id, index) => {
      const row = rows.find((r) => r.id === id);
      if (row && row.sort_order !== index + 1) {
        row.sort_order = index + 1;
        changes.push({ id, sort_order: index + 1 });
      }
    });
    if (!changes.length) return;
    if (table === 'categories') store.categories.sort(byOrder);
    render();
    const results = await Promise.all(changes.map((c) =>
      run(() => sb.from(table).update({ sort_order: c.sort_order }).eq('id', c.id), { silent: true })));
    const failed = results.find((r) => r.error);
    if (failed) {
      toast('Couldn’t save the new order. Reloading the menu…', { type: 'error' });
      await loadAll();
    } else {
      toast('Order saved', { type: 'success', duration: 1500 });
    }
  }

  function move(table, list, id, delta) {
    const ids = list.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(table, ids);
  }

  /** Drag handle that also works with the keyboard (arrow keys). */
  function dragHandle(label, onMove) {
    const btn = h('button', { type: 'button', class: 'drag-handle', 'aria-label': `Reorder ${label}. Drag, or press arrow up / down.` }, icon('grip', { size: 18 }));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        onMove(e.key === 'ArrowUp' ? -1 : 1);
      }
    });
    return btn;
  }

  /* ---------------- Items list ---------------- */

  function itemRow(item, siblings) {
    const badges = [];
    if (!item.in_stock) badges.push(h('span', { class: 'badge badge-danger' }, 'Sold out'));
    if (!item.is_visible) badges.push(h('span', { class: 'badge' }, icon('eyeOff', { size: 12 }), 'Hidden'));
    if (item.available_from || item.available_to) badges.push(h('span', { class: 'badge' }, icon('clock', { size: 12 }), 'Timed'));
    for (const t of item.tags || []) if (TAG_LABELS[t]) badges.push(h('span', { class: 'badge badge-accent' }, TAG_LABELS[t].label));

    const thumbEl = item.image_url
      ? h('div', { class: 'thumb' }, h('img', { src: item.image_url, alt: '', loading: 'lazy', width: 48, height: 48 }))
      : h('div', { class: 'thumb' }, h('span', { class: 'thumb-emoji', 'aria-hidden': 'true' }, emojiFor(item)));

    const eye = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-icon',
      'aria-label': item.is_visible ? `Hide ${item.name} from customers` : `Show ${item.name} to customers`,
      title: item.is_visible ? 'Visible to customers' : 'Hidden from customers',
      onClick: () => toggleItemVisible(item.id),
    }, icon(item.is_visible ? 'eye' : 'eyeOff', { size: 20 }));

    const more = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-icon',
      'aria-label': `More actions for ${item.name}`,
      'aria-haspopup': 'dialog',
      onClick: () => itemActions(item.id),
    }, icon('more', { size: 20 }));

    return h('div', { class: `editor-row ${item.is_visible ? '' : 'is-hidden'}`, dataset: { id: item.id } },
      dragHandle(item.name, (d) => move('menu_items', siblings, item.id, d)),
      h('button', { type: 'button', class: 'editor-main', onClick: () => openItemEditor(item.id), 'aria-label': `Edit ${item.name}` },
        thumbEl,
        h('span', { class: 'editor-text' },
          h('span', { class: 'editor-name' }, item.name),
          h('span', { class: 'editor-meta' }, h('span', { class: 'price' }, formatPrice(item.price, currency())), badges),
        ),
      ),
      eye,
      more,
    );
  }

  function renderItems() {
    clear(itemsView);
    if (!store.categories.length && !store.items.length) {
      itemsView.appendChild(emptyState({
        emoji: '🍽️',
        title: 'Let’s build your menu',
        message: 'Start with a category like “Tea” or “Snacks”, then add items to it.',
        action: h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openCategoryEditor(null) }, icon('plus', { size: 18 }), 'Add a category'),
      }));
      return;
    }

    const groups = store.categories.map((c) => ({ id: c.id, cat: c, items: itemsIn(c.id) }));
    const orphans = store.items.filter((i) => !i.category_id || !getCategory(i.category_id)).sort(byOrder);
    if (orphans.length) groups.push({ id: 'none', cat: null, items: orphans });

    let shown = 0;
    for (const g of groups) {
      const items = ui.query ? g.items.filter((i) => `${i.name} ${i.description || ''}`.toLowerCase().includes(ui.query)) : g.items;
      if (ui.query && !items.length) continue;
      shown += items.length;
      const list = h('div', { class: 'editor-list' });
      for (const item of items) list.appendChild(itemRow(item, g.items));
      if (!ui.query && g.items.length > 1) makeSortable(list, { onEnd: (ids) => saveOrder('menu_items', ids) });

      const addHere = g.cat ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => openItemEditor(null, g.cat.id) }, icon('plus', { size: 16 }), `Add to ${g.cat.name}`) : null;

      itemsView.appendChild(h('section', { class: 'editor-group card', 'aria-label': g.cat ? g.cat.name : 'Uncategorised' },
        h('div', { class: 'editor-group-head' },
          h('h3', { class: 'group-title' },
            h('span', { 'aria-hidden': 'true' }, g.cat?.emoji || '📦'),
            h('span', {}, g.cat ? g.cat.name : 'Uncategorised'),
            h('span', { class: 'group-count' }, plural(g.items.length, 'item')),
            g.cat && !g.cat.is_visible ? h('span', { class: 'badge' }, icon('eyeOff', { size: 12 }), 'Category hidden') : null,
          ),
          addHere,
        ),
        g.cat ? null : h('p', { class: 'group-warning' }, icon('alert', { size: 16 }), 'Customers can’t see uncategorised items. Edit each one and choose a category.'),
        items.length ? list : h('p', { class: 'group-empty muted small' }, 'No items yet.'),
      ));
    }
    if (ui.query && !shown) {
      itemsView.appendChild(emptyState({ emoji: '🔍', title: `No items match “${ui.query}”`, message: 'Try another word, or add it as a new item.' }));
    }
  }

  async function toggleItemVisible(id) {
    const item = getItem(id);
    const next = !item.is_visible;
    const res = await updateItem(id, { is_visible: next }, { action: next ? 'show the item' : 'hide the item' });
    if (res.error) return;
    toast(next ? `${item.name} is visible to customers` : `${item.name} hidden from customers`, {
      type: 'info',
      action: { label: 'Undo', onClick: () => updateItem(id, { is_visible: !next }, { action: 'undo' }) },
    });
  }

  function itemActions(id) {
    const item = getItem(id);
    if (!item) return;
    const siblings = item.category_id && getCategory(item.category_id) ? itemsIn(item.category_id) : store.items.filter((i) => !i.category_id || !getCategory(i.category_id)).sort(byOrder);
    const idx = siblings.findIndex((s) => s.id === id);
    let sheet;
    const act = (fn) => () => { sheet.close('action'); fn(); };
    const list = h('div', { class: 'action-list' },
      h('button', { type: 'button', class: 'action-btn', onClick: act(() => openItemEditor(id)) }, icon('edit'), 'Edit item'),
      h('button', { type: 'button', class: 'action-btn', onClick: act(() => duplicateItem(id)) }, icon('copy'), 'Duplicate'),
      h('button', { type: 'button', class: 'action-btn', disabled: idx <= 0, onClick: act(() => move('menu_items', siblings, id, -1)) }, icon('arrowUp'), 'Move up'),
      h('button', { type: 'button', class: 'action-btn', disabled: idx === -1 || idx >= siblings.length - 1, onClick: act(() => move('menu_items', siblings, id, 1)) }, icon('arrowDown'), 'Move down'),
      h('button', { type: 'button', class: 'action-btn', onClick: act(() => toggleItemVisible(id)) }, icon(item.is_visible ? 'eyeOff' : 'eye'), item.is_visible ? 'Hide from customers' : 'Show to customers'),
      h('button', { type: 'button', class: 'action-btn is-danger', onClick: act(() => deleteItem(id)) }, icon('trash'), 'Delete item'),
    );
    sheet = openSheet({ title: item.name, content: list });
  }

  const imageInUse = (url, exceptItemId) =>
    !!url && (store.items.some((i) => i.image_url === url && i.id !== exceptItemId) || store.settings?.logo_url === url);

  async function duplicateItem(id) {
    const item = getItem(id);
    const siblings = itemsIn(item.category_id);
    const { id: _id, created_at: _c, updated_at: _u, last_restocked_at: _r, last_stockout_at: _s, ...copy } = item;
    copy.name = `${item.name} (copy)`;
    copy.sort_order = (siblings.at(-1)?.sort_order || 0) + 1;
    const res = await run(() => sb.from('menu_items').insert(copy).select(ITEM_COLUMNS).single(), { action: 'duplicate the item' });
    if (res.error) return;
    putItem(res.data);
    toast(`Duplicated as “${copy.name}”`, { type: 'success', action: { label: 'Edit', onClick: () => openItemEditor(res.data.id) } });
  }

  async function deleteItem(id) {
    const item = getItem(id);
    if (!item) return false;
    const ok = await confirmDialog({
      title: `Delete ${item.name}?`,
      message: 'It disappears from the menu right away. Its stock history is deleted too. This can’t be undone — tip: you can hide it instead.',
      confirmLabel: 'Delete item',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return false;
    const res = await run(() => sb.from('menu_items').delete().eq('id', id), { action: 'delete the item' });
    if (res.error) return false;
    dropItem(id);
    if (!imageInUse(item.image_url, id)) deleteImageByUrl(item.image_url);
    toast(`${item.name} deleted`, { type: 'info' });
    return true;
  }

  /* ---------------- Item editor ---------------- */

  function openItemEditor(id, presetCategory) {
    const existing = id ? getItem(id) : null;
    if (!store.categories.length) {
      toast('Add a category first, then add items to it.', { type: 'info', action: { label: 'Add category', onClick: () => openCategoryEditor(null) } });
      return;
    }
    const draft = existing
      ? { ...existing, tags: [...(existing.tags || [])] }
      : {
          id: null, name: '', price: '', description: '', category_id: presetCategory || store.categories[0].id,
          is_veg: true, tags: [], image_url: null, is_visible: true, in_stock: true,
          track_qty: false, stock_qty: null, available_from: null, available_to: null,
        };
    let pendingBlob = null;   // new photo waiting to upload
    let pendingUrl = null;    // object URL for preview
    let removePhoto = false;
    let dirty = false;
    let saving = false;

    /* --- fields --- */
    const fid = (n) => `item-${n}`;
    const errorEl = (n) => h('p', { class: 'field-error', id: `${fid(n)}-error`, 'aria-live': 'polite' });
    const field = (n, label, input, { hint, required } = {}) => h('div', { class: 'field' },
      h('label', { class: 'field-label', for: fid(n) }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null),
      input,
      hint ? h('p', { class: 'field-hint', id: `${fid(n)}-hint` }, hint) : null,
      errorEl(n),
    );

    const nameIn = h('input', { class: 'input', id: fid('name'), maxlength: 60, required: true, value: draft.name, autocomplete: 'off', 'aria-describedby': `${fid('name')}-error` });
    const priceIn = h('input', { class: 'input has-prefix', id: fid('price'), type: 'number', inputmode: 'decimal', min: 0, step: '0.5', required: true, value: draft.price === '' ? '' : String(Number(draft.price)), 'aria-describedby': `${fid('price')}-error` });
    const catSel = h('select', { class: 'select', id: fid('category'), required: true, 'aria-describedby': `${fid('category')}-error` },
      !draft.category_id || !getCategory(draft.category_id) ? h('option', { value: '' }, 'Choose a category…') : null,
      store.categories.map((c) => h('option', { value: c.id, selected: c.id === draft.category_id }, `${c.emoji || ''} ${c.name}`.trim())),
    );
    const descIn = h('textarea', { class: 'textarea', id: fid('desc'), maxlength: 160, rows: 3, 'aria-describedby': `${fid('desc')}-hint` });
    descIn.value = draft.description || '';
    const descCount = h('span', {});
    const vegRadios = h('div', { class: 'segmented veg-toggle', role: 'radiogroup', 'aria-label': 'Food type' });
    const vegBtn = h('button', { type: 'button', role: 'radio' }, h('span', { class: 'veg-mark is-veg', 'aria-hidden': 'true' }), 'Veg');
    const nonVegBtn = h('button', { type: 'button', role: 'radio' }, h('span', { class: 'veg-mark is-nonveg', 'aria-hidden': 'true' }), 'Non-veg');
    vegRadios.append(vegBtn, nonVegBtn);
    const tagChips = Object.entries(TAG_LABELS).map(([key, def]) => h('button', {
      type: 'button', class: 'chip', dataset: { tag: key }, 'aria-pressed': draft.tags.includes(key) ? 'true' : 'false',
    }, h('span', { 'aria-hidden': 'true' }, def.emoji), def.label));
    const visibleIn = h('input', { type: 'checkbox', id: fid('visible'), checked: draft.is_visible });
    const stockIn = h('input', { type: 'checkbox', id: fid('instock'), checked: draft.in_stock });
    const trackIn = h('input', { type: 'checkbox', id: fid('track'), checked: draft.track_qty });
    const qtyIn = h('input', { class: 'input', id: fid('qty'), type: 'number', inputmode: 'numeric', min: 0, step: 1, value: draft.stock_qty ?? '', 'aria-describedby': `${fid('qty')}-error` });
    const qtyField = field('qty', 'Quantity available now', qtyIn, { hint: 'At 0 the item is marked sold out automatically.' });
    const fromIn = h('input', { class: 'input', id: fid('from'), type: 'time', value: toInputTime(draft.available_from) });
    const toIn = h('input', { class: 'input', id: fid('to'), type: 'time', value: toInputTime(draft.available_to) });

    /* --- photo --- */
    const photoBox = h('div', { class: 'photo-box' });
    const choosePhoto = button('Choose photo', { icon: 'camera', variant: 'secondary', size: 'sm' });
    const removePhotoBtn = button('Remove', { icon: 'trash', variant: 'ghost', size: 'sm' });
    const photoUrl = () => (removePhoto ? null : pendingUrl || draft.image_url);

    const paintPhoto = () => {
      clear(photoBox);
      const url = photoUrl();
      if (url) photoBox.appendChild(h('img', { src: url, alt: 'Item photo preview', width: 96, height: 96 }));
      else photoBox.appendChild(h('span', { class: 'photo-empty', 'aria-hidden': 'true' }, icon('image', { size: 28 })));
      removePhotoBtn.hidden = !url;
    };

    choosePhoto.addEventListener('click', async () => {
      const file = await pickImageFile();
      if (!file) return;
      const blob = await cropImage(file, { size: 800, maxBytes: 200 * 1024, title: 'Crop item photo' });
      if (!blob) return;
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      pendingBlob = blob;
      pendingUrl = URL.createObjectURL(blob);
      removePhoto = false;
      dirty = true;
      paintPhoto();
      paintPreview();
      toast(`Photo ready (${Math.round(blob.size / 1024)} KB) — it uploads when you save`, { type: 'success', duration: 2500 });
    });
    removePhotoBtn.addEventListener('click', () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      pendingBlob = null;
      pendingUrl = null;
      removePhoto = true;
      dirty = true;
      paintPhoto();
      paintPreview();
    });

    /* --- preview --- */
    const previewWrap = h('div', { class: 'preview-wrap', 'aria-label': 'Live preview', role: 'img' });

    const readForm = () => ({
      name: nameIn.value.trim(),
      price: priceIn.value === '' ? NaN : Number(priceIn.value),
      category_id: catSel.value || null,
      description: descIn.value.trim() || null,
      is_veg: draft.is_veg,
      tags: tagChips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.tag),
      is_visible: visibleIn.checked,
      in_stock: stockIn.checked,
      track_qty: trackIn.checked,
      stock_qty: trackIn.checked ? (qtyIn.value === '' ? 0 : Number(qtyIn.value)) : null,
      available_from: fromIn.value || null,
      available_to: toIn.value || null,
    });

    const paintPreview = () => {
      const f = readForm();
      const previewItem = {
        ...draft, ...f,
        id: draft.id || 'preview',
        name: f.name || 'Item name',
        price: Number.isFinite(f.price) ? f.price : 0,
        image_url: photoUrl(),
        in_stock: f.track_qty && f.stock_qty === 0 ? false : f.in_stock,
        available_from: f.available_from ? `${f.available_from}:00` : null,
        available_to: f.available_to ? `${f.available_to}:00` : null,
        last_restocked_at: draft.last_restocked_at,
      };
      clear(previewWrap).appendChild(createItemCard(previewItem, { currency: currency(), emoji: getCategory(f.category_id)?.emoji, preview: true }));
      previewWrap.setAttribute('aria-label', `Preview of ${previewItem.name} as customers will see it`);
      descCount.textContent = `${descIn.value.length}/160`;
      qtyField.hidden = !trackIn.checked;
    };

    const paintVeg = () => {
      vegBtn.setAttribute('aria-checked', draft.is_veg ? 'true' : 'false');
      vegBtn.setAttribute('aria-pressed', draft.is_veg ? 'true' : 'false');
      nonVegBtn.setAttribute('aria-checked', draft.is_veg ? 'false' : 'true');
      nonVegBtn.setAttribute('aria-pressed', draft.is_veg ? 'false' : 'true');
      vegBtn.tabIndex = draft.is_veg ? 0 : -1;
      nonVegBtn.tabIndex = draft.is_veg ? -1 : 0;
    };
    const setVeg = (v) => { draft.is_veg = v; dirty = true; paintVeg(); paintPreview(); };
    vegBtn.addEventListener('click', () => setVeg(true));
    nonVegBtn.addEventListener('click', () => setVeg(false));
    vegRadios.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        setVeg(!draft.is_veg);
        (draft.is_veg ? vegBtn : nonVegBtn).focus();
      }
    });
    for (const chip of tagChips) {
      chip.addEventListener('click', () => {
        chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        dirty = true;
        paintPreview();
      });
    }

    const form = h('form', { class: 'item-form', novalidate: true },
      h('div', { class: 'preview-block' }, h('p', { class: 'field-label' }, 'Preview'), previewWrap),
      h('div', { class: 'field' },
        h('p', { class: 'field-label', id: fid('photo-label') }, 'Photo'),
        h('div', { class: 'photo-row', role: 'group', 'aria-labelledby': fid('photo-label') }, photoBox, h('div', { class: 'photo-actions' }, choosePhoto, removePhotoBtn,
          h('p', { class: 'field-hint' }, 'Square, from camera or gallery. Compressed before upload.'))),
      ),
      field('name', 'Name', nameIn, { required: true }),
      h('div', { class: 'field-row' },
        field('price', `Price (${currency()})`, h('div', { class: 'input-wrap' }, h('span', { class: 'input-prefix', 'aria-hidden': 'true' }, currency()), priceIn), { required: true }),
        field('category', 'Category', catSel, { required: true }),
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: fid('desc') }, 'Description'),
        descIn,
        h('p', { class: 'field-hint field-hint-row', id: `${fid('desc')}-hint` }, h('span', {}, 'One short line works best.'), descCount),
      ),
      h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Food type'), vegRadios),
      h('div', { class: 'field' }, h('p', { class: 'field-label', id: fid('tags-label') }, 'Tags'), h('div', { class: 'chip-wrap', role: 'group', 'aria-labelledby': fid('tags-label') }, tagChips)),
      h('div', { class: 'field checks' },
        h('label', { class: 'check', for: fid('visible') }, visibleIn, 'Show on the customer menu'),
        h('label', { class: 'check', for: fid('instock') }, stockIn, 'In stock now'),
        h('label', { class: 'check', for: fid('track') }, trackIn, 'Track quantity (e.g. 24 samosas)'),
      ),
      qtyField,
      h('fieldset', { class: 'field' },
        h('legend', { class: 'field-label' }, 'Serving hours (optional)'),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', { class: 'field-hint', for: fid('from') }, 'Available from'), fromIn),
          h('div', { class: 'field' }, h('label', { class: 'field-hint', for: fid('to') }, 'Available until'), toIn),
        ),
        h('p', { class: 'field-hint' }, 'Leave empty to serve all day. Outside these hours customers see “Available from …”.'),
        errorEl('from'),
      ),
    );

    form.addEventListener('input', () => { dirty = true; paintPreview(); });
    form.addEventListener('change', () => { dirty = true; paintPreview(); });

    /* --- validation --- */
    const setError = (n, msg) => {
      const input = form.querySelector(`#${fid(n)}`);
      const err = form.querySelector(`#${fid(n)}-error`);
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (err) { clear(err); if (msg) err.append(icon('alert', { size: 14 }), msg); }
    };
    const validate = (f) => {
      const errors = {};
      if (!f.name) errors.name = 'Give the item a name.';
      else if (store.items.some((i) => i.id !== draft.id && i.name.toLowerCase() === f.name.toLowerCase() && i.category_id === f.category_id)) errors.name = 'An item with this name already exists in this category.';
      if (!Number.isFinite(f.price) || f.price < 0) errors.price = 'Enter a price, like 15 or 12.50.';
      else if (f.price > 999999) errors.price = 'That price looks too high.';
      if (!f.category_id) errors.category = 'Choose a category.';
      if (f.track_qty && (!Number.isInteger(f.stock_qty) || f.stock_qty < 0)) errors.qty = 'Enter a whole number (0 or more).';
      if (f.available_from && f.available_to && f.available_from === f.available_to) errors.from = 'Start and end time can’t be the same.';
      for (const n of ['name', 'price', 'category', 'qty', 'from']) setError(n, errors[n] || '');
      return errors;
    };

    /* --- save --- */
    const saveBtn = button(existing ? 'Save changes' : 'Add item', { icon: 'check', variant: 'primary', size: 'lg', type: 'submit' });
    const deleteBtn = existing ? button('Delete', { icon: 'trash', variant: 'danger-soft', size: 'lg', ariaLabel: 'Delete item' }) : null;

    const save = async (e) => {
      e?.preventDefault();
      if (saving) return;
      const f = readForm();
      const errors = validate(f);
      const firstBad = Object.keys(errors)[0];
      if (firstBad) {
        const target = form.querySelector(`#${fid(firstBad)}`);
        target?.focus();
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      saving = true;
      setBusy(saveBtn, true, 'Saving…');

      let imageUrl = draft.image_url;
      let uploadedUrl = null;
      if (pendingBlob) {
        const up = await uploadImage(pendingBlob, 'items');
        if (up.error) {
          saving = false;
          setBusy(saveBtn, false);
          if (!/Couldn’t|offline|Permission/.test(up.error.message)) toast(up.error.message, { type: 'error' });
          return;
        }
        uploadedUrl = up.data;
        imageUrl = uploadedUrl;
      } else if (removePhoto) {
        imageUrl = null;
      }

      const payload = { ...f, image_url: imageUrl };
      if (!existing) {
        const siblings = itemsIn(f.category_id);
        payload.sort_order = (siblings.at(-1)?.sort_order || 0) + 1;
      } else if (existing.category_id !== f.category_id) {
        payload.sort_order = (itemsIn(f.category_id).at(-1)?.sort_order || 0) + 1;
      }

      const res = existing
        ? await run(() => sb.from('menu_items').update(payload).eq('id', existing.id).select(ITEM_COLUMNS).single(), { action: 'save the item', retry: save })
        : await run(() => sb.from('menu_items').insert(payload).select(ITEM_COLUMNS).single(), { action: 'add the item', retry: save });

      saving = false;
      setBusy(saveBtn, false);
      if (res.error) {
        if (uploadedUrl) deleteImageByUrl(uploadedUrl); // don't leave orphans behind
        return;
      }
      // Replaced or removed a photo → clean the old file out of Storage.
      const oldUrl = existing?.image_url;
      if (oldUrl && oldUrl !== res.data.image_url && !imageInUse(oldUrl, existing.id)) deleteImageByUrl(oldUrl);

      putItem(res.data);
      dirty = false;
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      sheet.close('saved');
      toast(existing ? `${res.data.name} saved` : `${res.data.name} added to the menu`, { type: 'success', emoji: emojiFor(res.data) });
    };

    form.addEventListener('submit', save);
    saveBtn.addEventListener('click', save);

    const sheet = openSheet({
      title: existing ? `Edit ${existing.name}` : 'New item',
      content: form,
      footer: h('div', { class: 'editor-actions' }, deleteBtn, saveBtn),
      variant: 'side',
      className: 'item-editor',
      initialFocus: existing ? undefined : nameIn,
      beforeClose: async () => {
        if (!dirty) return true;
        return confirmDialog({ title: 'Discard changes?', message: 'Your edits to this item haven’t been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
      },
      onClose: () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl); },
    });

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (await deleteItem(existing.id)) { dirty = false; sheet.close('deleted'); }
      });
    }

    paintVeg();
    paintPhoto();
    paintPreview();
  }

  /* ---------------- Categories ---------------- */

  function renderCategories() {
    clear(catsView);
    if (!store.categories.length) {
      catsView.appendChild(emptyState({
        emoji: '🗂️',
        title: 'No categories yet',
        message: 'Categories group your menu, like ☕ Tea or 🥟 Snacks.',
        action: h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openCategoryEditor(null) }, icon('plus', { size: 18 }), 'Add a category'),
      }));
      return;
    }
    const list = h('div', { class: 'editor-list card' });
    const cats = [...store.categories];
    cats.forEach((cat, idx) => {
      const count = store.items.filter((i) => i.category_id === cat.id).length;
      list.appendChild(h('div', { class: `editor-row ${cat.is_visible ? '' : 'is-hidden'}`, dataset: { id: cat.id } },
        dragHandle(cat.name, (d) => move('categories', cats, cat.id, d)),
        h('button', { type: 'button', class: 'editor-main', onClick: () => openCategoryEditor(cat.id), 'aria-label': `Edit category ${cat.name}` },
          h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, cat.emoji || '📦'),
          h('span', { class: 'editor-text' },
            h('span', { class: 'editor-name' }, cat.name),
            h('span', { class: 'editor-meta' }, plural(count, 'item'), !cat.is_visible ? h('span', { class: 'badge' }, icon('eyeOff', { size: 12 }), 'Hidden') : null),
          ),
        ),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon hide-xs', 'aria-label': `Move ${cat.name} up`, disabled: idx === 0, onClick: () => move('categories', cats, cat.id, -1),
        }, icon('chevronUp', { size: 20 })),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon hide-xs', 'aria-label': `Move ${cat.name} down`, disabled: idx === cats.length - 1, onClick: () => move('categories', cats, cat.id, 1),
        }, icon('chevronDown', { size: 20 })),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon',
          'aria-label': cat.is_visible ? `Hide ${cat.name} from customers` : `Show ${cat.name} to customers`,
          onClick: () => toggleCategoryVisible(cat.id),
        }, icon(cat.is_visible ? 'eye' : 'eyeOff', { size: 20 })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': `More actions for ${cat.name}`, 'aria-haspopup': 'dialog', onClick: () => categoryActions(cat.id) }, icon('more', { size: 20 })),
      ));
    });
    makeSortable(list, { onEnd: (ids) => saveOrder('categories', ids) });
    catsView.appendChild(list);
    catsView.appendChild(h('p', { class: 'muted small cat-tip' }, 'Tip: hidden categories (and their items) disappear from the customer menu but stay here.'));
  }

  async function toggleCategoryVisible(id) {
    const cat = getCategory(id);
    const next = !cat.is_visible;
    putCategory({ ...cat, is_visible: next });
    const res = await run(() => sb.from('categories').update({ is_visible: next }).eq('id', id), { action: 'update the category' });
    if (res.error) { putCategory({ ...cat }); return; }
    toast(next ? `${cat.name} is visible to customers` : `${cat.name} hidden from customers`, {
      type: 'info',
      action: { label: 'Undo', onClick: () => toggleCategoryVisible(id) },
    });
  }

  function categoryActions(id) {
    const cat = getCategory(id);
    const cats = [...store.categories];
    const idx = cats.findIndex((c) => c.id === id);
    let sheet;
    const act = (fn) => () => { sheet.close('action'); fn(); };
    sheet = openSheet({
      title: `${cat.emoji || ''} ${cat.name}`.trim(),
      content: h('div', { class: 'action-list' },
        h('button', { type: 'button', class: 'action-btn', onClick: act(() => openCategoryEditor(id)) }, icon('edit'), 'Rename / change emoji'),
        h('button', { type: 'button', class: 'action-btn', disabled: idx <= 0, onClick: act(() => move('categories', cats, id, -1)) }, icon('arrowUp'), 'Move up'),
        h('button', { type: 'button', class: 'action-btn', disabled: idx >= cats.length - 1, onClick: act(() => move('categories', cats, id, 1)) }, icon('arrowDown'), 'Move down'),
        h('button', { type: 'button', class: 'action-btn', onClick: act(() => toggleCategoryVisible(id)) }, icon(cat.is_visible ? 'eyeOff' : 'eye'), cat.is_visible ? 'Hide from customers' : 'Show to customers'),
        h('button', { type: 'button', class: 'action-btn is-danger', onClick: act(() => deleteCategory(id)) }, icon('trash'), 'Delete category'),
      ),
    });
  }

  async function deleteCategory(id) {
    const cat = getCategory(id);
    const count = store.items.filter((i) => i.category_id === id).length;
    const ok = await confirmDialog({
      title: `Delete “${cat.name}”?`,
      message: count
        ? `${plural(count, 'item')} will become uncategorised and hidden from customers until you move them to another category. The items themselves are kept.`
        : 'This category is empty. This can’t be undone.',
      confirmLabel: 'Delete category',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const res = await run(() => sb.from('categories').delete().eq('id', id), { action: 'delete the category' });
    if (res.error) return;
    dropCategory(id);
    toast(`${cat.name} deleted${count ? ` · ${plural(count, 'item')} now uncategorised` : ''}`, { type: 'info' });
  }

  function openCategoryEditor(id) {
    const existing = id ? getCategory(id) : null;
    let emoji = existing?.emoji || '☕';
    const nameIn = h('input', { class: 'input', id: 'cat-name', maxlength: 40, value: existing?.name || '', autocomplete: 'off', required: true, 'aria-describedby': 'cat-name-error' });
    const nameErr = h('p', { class: 'field-error', id: 'cat-name-error' });
    const customIn = h('input', { class: 'input emoji-input', id: 'cat-emoji', maxlength: 8, value: emoji, 'aria-describedby': 'cat-emoji-hint' });
    const grid = h('div', { class: 'emoji-grid', role: 'radiogroup', 'aria-label': 'Pick an emoji' });
    const paintGrid = () => {
      for (const b of grid.children) {
        const on = b.dataset.emoji === emoji;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on || (!EMOJIS.includes(emoji) && b === grid.firstElementChild) ? 0 : -1;
      }
    };
    EMOJIS.forEach((e) => grid.appendChild(h('button', {
      type: 'button', role: 'radio', class: 'emoji-btn', dataset: { emoji: e }, 'aria-label': e,
      onClick: () => { emoji = e; customIn.value = e; paintGrid(); },
    }, e)));
    grid.addEventListener('keydown', (e) => {
      const btns = [...grid.children];
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = Math.round(grid.clientWidth / (btns[0].offsetWidth || 44)) || 8;
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!delta) return;
      e.preventDefault();
      const next = btns[Math.max(0, Math.min(btns.length - 1, i + delta))];
      next.focus();
      next.click();
    });
    customIn.addEventListener('input', () => { emoji = customIn.value.trim(); paintGrid(); });
    const visibleIn = h('input', { type: 'checkbox', id: 'cat-visible', checked: existing ? existing.is_visible : true });

    const form = h('form', { class: 'cat-form', novalidate: true },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'cat-name' }, 'Name', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), nameIn, nameErr),
      h('div', { class: 'field' },
        h('p', { class: 'field-label' }, 'Emoji'),
        grid,
        h('div', { class: 'emoji-custom' },
          h('label', { class: 'field-hint', for: 'cat-emoji' }, 'Or type any emoji:'),
          customIn,
        ),
        h('p', { class: 'field-hint', id: 'cat-emoji-hint' }, 'Shown on the customer menu’s category chips.'),
      ),
      h('label', { class: 'check', for: 'cat-visible' }, visibleIn, 'Show on the customer menu'),
    );
    const saveBtn = button(existing ? 'Save' : 'Add category', { icon: 'check', variant: 'primary', size: 'lg', type: 'submit', className: 'btn-block' });

    const save = async (e) => {
      e?.preventDefault();
      const name = nameIn.value.trim();
      clear(nameErr);
      nameIn.setAttribute('aria-invalid', 'false');
      let msg = '';
      if (!name) msg = 'Give the category a name.';
      else if (store.categories.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) msg = 'You already have a category with this name.';
      if (msg) { nameErr.append(icon('alert', { size: 14 }), msg); nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus(); return; }
      setBusy(saveBtn, true, 'Saving…');
      const payload = { name, emoji: emoji || null, is_visible: visibleIn.checked };
      if (!existing) payload.sort_order = (store.categories.at(-1)?.sort_order || 0) + 1;
      const res = existing
        ? await run(() => sb.from('categories').update(payload).eq('id', id).select('*').single(), { action: 'save the category' })
        : await run(() => sb.from('categories').insert(payload).select('*').single(), { action: 'add the category' });
      setBusy(saveBtn, false);
      if (res.error) return;
      putCategory(res.data);
      sheet.close('saved');
      toast(existing ? 'Category saved' : `${res.data.emoji || ''} ${res.data.name} added`.trim(), { type: 'success' });
    };
    form.addEventListener('submit', save);
    saveBtn.addEventListener('click', save);

    const sheet = openSheet({ title: existing ? 'Edit category' : 'New category', content: form, footer: saveBtn, initialFocus: nameIn });
    paintGrid();
  }

  /* ---------------- Wiring ---------------- */

  function render() {
    // Re-rendering rebuilds rows; put keyboard focus back on the same control.
    const active = document.activeElement;
    const row = active && panel.contains(active) ? active.closest('.editor-row') : null;
    const index = row ? Array.from(row.querySelectorAll('button')).indexOf(active) : -1;
    if (ui.view === 'items') renderItems();
    else renderCategories();
    if (row && index >= 0) {
      const again = panel.querySelector(`.editor-row[data-id="${CSS.escape(row.dataset.id)}"]`);
      const target = again && again.querySelectorAll('button')[index];
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else if (again) again.querySelector('.editor-main').focus({ preventScroll: true });
    }
  }

  // Coalesce bursts of Realtime events into one render.
  const scheduleRender = debounce(render, 60);
  subscribe((e) => {
    if (['item', 'item_removed', 'items', 'categories', 'loaded', 'settings'].includes(e.type)) {
      // Don't yank a row out from under an active drag.
      if (panel.querySelector('.is-sorting')) return;
      scheduleRender();
    }
  });

  render();
  return {};
}

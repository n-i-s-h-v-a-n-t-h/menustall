// Customer menu rendering. Cards are keyed by item id and only replaced
// when something visible about them changed, so live updates are cheap
// and never reset the customer's scroll position.

import { h, icon, clear, openSheet, stepper, emptyState, $, prefersReducedMotion } from '../lib/ui.js';
import {
  formatPrice, getItemWindow, getShopStatus, isFresh, isLowStock, hashString,
  formatClock, TAG_LABELS,
} from '../lib/format.js';

const cardEls = new Map();     // item id → card element
const sectionEls = new Map();  // category id → { section, list }
let chipEls = new Map();       // category id → chip button
let spyObserver = null;
let spyLockUntil = 0;

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function renderHeader(settings, table) {
  const nameEl = $('#shop-name');
  clear(nameEl).textContent = settings?.shop_name || 'Our Menu';
  $('#shop-tagline').textContent = settings?.tagline || '';
  document.title = `${settings?.shop_name || 'Menu'} · Menu`;

  const logo = $('#shop-logo');
  clear(logo);
  if (settings?.logo_url) {
    const img = h('img', { src: settings.logo_url, alt: '', width: 56, height: 56, decoding: 'async' });
    img.addEventListener('error', () => { clear(logo).textContent = '☕'; });
    logo.appendChild(img);
  } else {
    logo.textContent = '☕';
  }

  const chip = $('#table-chip');
  if (table) {
    chip.hidden = false;
    clear(chip).append(icon('table', { size: 16 }), h('span', {}, `Table ${table}`));
  } else {
    chip.hidden = true;
  }

  renderStatus(settings);
  renderFooter(settings);
}

export function renderStatus(settings) {
  const pill = $('#status-pill');
  if (!settings) { pill.hidden = true; return; }
  const status = getShopStatus(settings);
  pill.hidden = false;
  pill.className = `status-pill is-${status.tone}`;
  clear(pill).append(h('span', { class: 'dot' }), h('span', {}, status.label));
}

function renderFooter(settings) {
  const hours = $('#footer-hours');
  if (!hours) return;
  if (settings?.open_time && settings?.close_time) {
    hours.textContent = `Open daily ${formatClock(settings.open_time)} – ${formatClock(settings.close_time)}`;
  } else {
    hours.textContent = '';
  }
}

const ANNOUNCE_KEY = 'chaimenu:announcement-dismissed';

export function renderAnnouncement(settings) {
  const bar = $('#announcement');
  const text = (settings?.announcement || '').trim();
  let dismissed = null;
  try { dismissed = sessionStorage.getItem(ANNOUNCE_KEY); } catch { /* ignore */ }
  if (!text || dismissed === text) { bar.hidden = true; return; }
  bar.hidden = false;
  clear(bar).append(
    h('span', { class: 'announcement-icon', 'aria-hidden': 'true' }, icon('megaphone', { size: 18 })),
    h('p', { class: 'announcement-text' }, text),
    h('button', {
      type: 'button',
      class: 'announcement-close',
      'aria-label': 'Dismiss announcement',
      onClick: () => {
        try { sessionStorage.setItem(ANNOUNCE_KEY, text); } catch { /* ignore */ }
        bar.classList.add('is-leaving');
        setTimeout(() => { bar.hidden = true; bar.classList.remove('is-leaving'); }, prefersReducedMotion() ? 0 : 200);
      },
    }, icon('x', { size: 18 })),
  );
}

/** "Reconnecting…" pill. */
export function setLiveStatus(status) {
  const pill = $('#live-pill');
  if (status === 'live') {
    if (!pill.hidden) {
      pill.className = 'live-pill is-live';
      clear(pill).append(h('span', { class: 'dot' }), 'Live');
      setTimeout(() => { pill.hidden = true; }, 1600);
    }
  } else {
    pill.hidden = false;
    pill.className = 'live-pill is-reconnecting';
    clear(pill).append(icon('wifiOff', { size: 14 }), status === 'offline' ? 'Offline · showing last menu' : 'Reconnecting…');
  }
}

/* ------------------------------------------------------------------ */
/* Item card (also used by the dashboard's live preview)               */
/* ------------------------------------------------------------------ */

export function placeholderMedia(item, emoji, className = 'ph') {
  const n = (hashString(item.id || item.name || 'x') % 5) + 1;
  return h('div', { class: className, style: { backgroundImage: `var(--grad-placeholder-${n})` } },
    h('span', { class: 'ph-emoji', 'aria-hidden': 'true' }, emoji || '☕'));
}

function media(item, emoji, className) {
  const wrap = h('div', { class: className });
  if (item.image_url) {
    const img = h('img', { src: item.image_url, alt: '', loading: 'lazy', decoding: 'async', width: 400, height: 400 });
    img.addEventListener('error', () => { img.replaceWith(placeholderMedia(item, emoji)); });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(placeholderMedia(item, emoji));
  }
  return wrap;
}

function tagBadges(item, { fresh } = {}) {
  const tags = [];
  if (fresh) tags.push(h('span', { class: 'badge badge-fresh' }, h('span', { 'aria-hidden': 'true' }, '🔥'), 'Just in'));
  for (const tag of item.tags || []) {
    const def = TAG_LABELS[tag];
    if (!def) continue;
    tags.push(h('span', { class: `badge tag-${tag}` }, h('span', { 'aria-hidden': 'true' }, def.emoji), def.label));
  }
  return tags.length ? h('div', { class: 'item-tags' }, tags) : null;
}

export function itemState(item, now = new Date()) {
  const win = getItemWindow(item, now);
  const soldOut = !item.in_stock;
  return {
    soldOut,
    unavailable: !soldOut && !win.available,
    windowLabel: win.label,
    low: !soldOut && isLowStock(item),
    fresh: isFresh(item, now.getTime()),
  };
}

/** Everything that affects how a card looks — used to skip no-op re-renders. */
function cardSignature(item, ctx) {
  const s = itemState(item, ctx.now);
  return [item.name, item.description, item.price, item.image_url, item.is_veg, (item.tags || []).join(','),
    s.soldOut, s.unavailable, s.windowLabel, s.low, s.fresh, ctx.currency, ctx.emoji, ctx.pickQty ? ctx.pickQty(item.id) : 0].join('|');
}

/**
 * Build a menu item card.
 * ctx: { currency, emoji, now, pickQty(id), onOpen(item), onAdd(item, btn), preview }
 */
export function createItemCard(item, ctx = {}) {
  const now = ctx.now || new Date();
  const currency = ctx.currency || '₹';
  const s = itemState(item, now);
  const qty = ctx.pickQty ? ctx.pickQty(item.id) : 0;
  const price = formatPrice(item.price, currency);

  const card = h('article', {
    class: ['item-card', s.soldOut && 'is-soldout', s.unavailable && 'is-unavailable', s.fresh && 'is-fresh'].filter(Boolean).join(' '),
    dataset: { id: item.id || 'preview' },
  });
  card.dataset.sig = cardSignature(item, { ...ctx, now });

  const statusBits = [];
  if (s.soldOut) statusBits.push(h('span', { class: 'item-status is-soldout' }, 'Sold out'));
  else if (s.unavailable) statusBits.push(h('span', { class: 'item-status is-later' }, icon('clock', { size: 14 }), s.windowLabel));
  else if (s.low) statusBits.push(h('span', { class: 'item-status is-low' }, icon('alert', { size: 14 }), 'Only a few left'));

  const hit = h('button', {
    type: 'button',
    class: 'item-hit',
    'aria-label': `${item.name}, ${price}${s.soldOut ? ', sold out' : s.unavailable ? `, ${s.windowLabel}` : ''}. View details`,
    onClick: () => ctx.onOpen && ctx.onOpen(item),
    tabIndex: ctx.preview ? -1 : 0,
  });

  const body = h('div', { class: 'item-body' },
    h('div', { class: 'item-title-row' },
      h('span', { class: `veg-mark ${item.is_veg ? 'is-veg' : 'is-nonveg'}`, role: 'img', 'aria-label': item.is_veg ? 'Vegetarian' : 'Non-vegetarian' }),
      h('h3', { class: 'item-name' }, item.name || 'Item name'),
    ),
    tagBadges(item, { fresh: s.fresh }),
    item.description ? h('p', { class: 'item-desc' }, item.description) : null,
    h('div', { class: 'item-meta' }, h('span', { class: 'price item-price' }, price), statusBits),
  );

  const addBtn = h('button', {
    type: 'button',
    class: `add-btn ${qty ? 'has-qty' : ''}`,
    disabled: s.soldOut || s.unavailable,
    'aria-label': s.soldOut ? `${item.name} is sold out` : qty ? `Add another ${item.name} (${qty} in My Picks)` : `Add ${item.name} to My Picks`,
    tabIndex: ctx.preview ? -1 : 0,
    onClick: (e) => {
      e.stopPropagation();
      if (ctx.onAdd) ctx.onAdd(item, addBtn);
    },
  }, qty ? h('span', { class: 'add-qty' }, String(qty)) : icon('plus', { size: 20, strokeWidth: 2.5 }));

  const mediaEl = media(item, ctx.emoji, 'item-media');
  if (s.soldOut) mediaEl.appendChild(h('span', { class: 'ribbon' }, 'Sold out'));
  mediaEl.appendChild(addBtn);

  card.append(hit, body, mediaEl);
  return card;
}

/* ------------------------------------------------------------------ */
/* Sections + category chips                                           */
/* ------------------------------------------------------------------ */

function sortForDisplay(items, now) {
  const rank = (it) => {
    const s = itemState(it, now);
    return s.soldOut ? 2 : s.unavailable ? 1 : 0;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Build the whole menu skeleton (sections + chips). Cards are synced after. */
export function renderMenu(state, handlers) {
  const container = $('#sections');
  const chipRow = $('#category-chips');
  clear(container);
  clear(chipRow);
  cardEls.clear();
  sectionEls.clear();
  chipEls = new Map();

  for (const cat of state.categories) {
    const titleId = `cat-${cat.id}-title`;
    const list = h('div', { class: 'item-list' });
    const section = h('section', { class: 'menu-section', id: `cat-${cat.id}`, 'aria-labelledby': titleId, dataset: { id: cat.id } },
      h('h2', { class: 'section-title', id: titleId },
        cat.emoji ? h('span', { class: 'section-emoji', 'aria-hidden': 'true' }, cat.emoji) : null,
        cat.name,
        h('span', { class: 'section-count' }),
      ),
      list,
    );
    container.appendChild(section);
    sectionEls.set(cat.id, { section, list, cat });

    const chip = h('button', {
      type: 'button',
      class: 'chip cat-chip',
      dataset: { id: cat.id },
      onClick: () => scrollToSection(cat.id),
    }, cat.emoji ? h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, cat.emoji) : null, cat.name);
    chipRow.appendChild(chip);
    chipEls.set(cat.id, chip);
  }

  syncAllSections(state, handlers);
  setupScrollSpy();
}

function cardContext(state, handlers, cat) {
  return {
    currency: state.settings?.currency_symbol || '₹',
    emoji: cat?.emoji,
    now: new Date(),
    pickQty: handlers.pickQty,
    onOpen: handlers.onOpen,
    onAdd: handlers.onAdd,
  };
}

/** Re-sync one category's cards: inserts, removes, reorders and replaces changed cards. */
export function syncSection(state, handlers, catId, { animateIds = new Set() } = {}) {
  const entry = sectionEls.get(catId);
  if (!entry) return;
  const ctx = cardContext(state, handlers, entry.cat);
  const items = sortForDisplay([...state.items.values()].filter((it) => it.category_id === catId), ctx.now);
  const keep = new Set(items.map((it) => it.id));

  // Remove cards that left this section.
  for (const el of Array.from(entry.list.children)) {
    if (!keep.has(el.dataset.id)) {
      cardEls.delete(el.dataset.id);
      el.remove();
    }
  }

  items.forEach((item, index) => {
    let el = cardEls.get(item.id);
    const sig = cardSignature(item, ctx);
    if (!el || el.dataset.sig !== sig || el.parentElement !== entry.list) {
      const hadFocus = el && el.contains(document.activeElement);
      const focusAdd = hadFocus && document.activeElement.classList.contains('add-btn');
      const fresh = createItemCard(item, ctx);
      if (el) {
        el.replaceWith(fresh);
        if (animateIds.has(item.id)) fresh.classList.add('is-changed');
      }
      el = fresh;
      cardEls.set(item.id, el);
      if (hadFocus) {
        const target = focusAdd && !el.querySelector('.add-btn').disabled ? el.querySelector('.add-btn') : el.querySelector('.item-hit');
        target.focus({ preventScroll: true });
      }
    }
    // Keep DOM order in sync with the sort (moves nodes without re-creating them).
    if (entry.list.children[index] !== el) entry.list.insertBefore(el, entry.list.children[index] || null);
  });

  const countEl = entry.section.querySelector('.section-count');
  countEl.textContent = items.length ? String(items.length) : '';
  entry.section.dataset.empty = items.length ? '' : '1';
}

export function syncAllSections(state, handlers, opts) {
  for (const catId of sectionEls.keys()) syncSection(state, handlers, catId, opts);
}

/* ------------------------------------------------------------------ */
/* Search & filters                                                    */
/* ------------------------------------------------------------------ */

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function applyFilters(state, handlers) {
  const q = norm(state.query.trim());
  const now = new Date();
  let visibleTotal = 0;

  for (const [catId, entry] of sectionEls) {
    let visible = 0;
    const catName = norm(entry.cat.name);
    for (const el of entry.list.children) {
      const item = state.items.get(el.dataset.id);
      if (!item) continue;
      const s = itemState(item, now);
      let ok = true;
      if (state.filters.veg && !item.is_veg) ok = false;
      if (ok && state.filters.available && (s.soldOut || s.unavailable)) ok = false;
      if (ok && state.filters.best && !(item.tags || []).includes('bestseller')) ok = false;
      if (ok && q) {
        const hay = norm(`${item.name} ${item.description || ''} ${(item.tags || []).join(' ')} ${catName}`);
        ok = q.split(/\s+/).every((word) => hay.includes(word));
      }
      el.hidden = !ok;
      if (ok) visible++;
    }
    entry.section.hidden = visible === 0;
    const chip = chipEls.get(catId);
    if (chip) chip.hidden = visible === 0;
    visibleTotal += visible;
  }

  const empty = $('#menu-empty');
  const filtering = q || state.filters.veg || state.filters.available || state.filters.best;
  if (visibleTotal === 0) {
    const suggestion = suggestWord(state);
    empty.hidden = false;
    clear(empty).appendChild(emptyState({
      emoji: q ? '🔍' : '🫖',
      title: q ? `No matches for “${state.query.trim()}”` : filtering ? 'Nothing matches these filters' : 'Menu coming soon',
      message: q ? `Try “${suggestion}”, or check the spelling.` : filtering ? 'Try removing a filter to see more.'
        : state.settings ? 'The owner is still setting things up.'
        : 'The owner is still setting things up. (Owner: the database has no shop details yet — run supabase/schema.sql in Supabase, see README step 2.)',
      action: filtering ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: handlers.onClearFilters }, icon('x', { size: 16 }), 'Clear search & filters') : null,
    }));
  } else {
    empty.hidden = true;
  }
  $('#sections').hidden = visibleTotal === 0;
}

function suggestWord(state) {
  const first = state.categories.find((c) => c.name);
  return first ? first.name.toLowerCase() : 'tea';
}

/* ------------------------------------------------------------------ */
/* Scroll spy + chip navigation                                        */
/* ------------------------------------------------------------------ */

function toolbarHeight() {
  const bar = $('#toolbar');
  return bar ? bar.getBoundingClientRect().height : 0;
}

export function updateScrollOffset() {
  document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil(toolbarHeight())}px`);
}

function scrollToSection(catId) {
  const entry = sectionEls.get(catId);
  if (!entry) return;
  setActiveChip(catId);
  spyLockUntil = Date.now() + 900;
  entry.section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  entry.section.querySelector('.section-title').setAttribute('tabindex', '-1');
  entry.section.querySelector('.section-title').focus({ preventScroll: true });
}

function setActiveChip(catId) {
  for (const [id, chip] of chipEls) {
    const active = id === catId;
    chip.classList.toggle('is-active', active);
    if (active) chip.setAttribute('aria-current', 'true');
    else chip.removeAttribute('aria-current');
    if (active) {
      const row = chip.parentElement;
      const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
      row.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }
}

function setupScrollSpy() {
  if (spyObserver) spyObserver.disconnect();
  updateScrollOffset();
  const visible = new Set();
  const top = Math.ceil(toolbarHeight()) + 8;
  spyObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target.dataset.id);
      else visible.delete(e.target.dataset.id);
    }
    if (Date.now() < spyLockUntil) return;
    const first = [...sectionEls.keys()].find((id) => visible.has(id) && !sectionEls.get(id).section.hidden);
    if (first) setActiveChip(first);
  }, { rootMargin: `-${top}px 0px -55% 0px`, threshold: 0 });
  for (const { section } of sectionEls.values()) spyObserver.observe(section);
}

/* ------------------------------------------------------------------ */
/* Fresh & Popular rails                                               */
/* ------------------------------------------------------------------ */

function miniCard(item, state, handlers, { badge } = {}) {
  const cat = state.categories.find((c) => c.id === item.category_id);
  const s = itemState(item);
  return h('button', {
    type: 'button',
    class: `mini-card ${s.soldOut ? 'is-soldout' : ''}`,
    'aria-label': `${item.name}, ${formatPrice(item.price, state.settings?.currency_symbol)}${s.soldOut ? ', sold out' : ''}. View details`,
    onClick: () => handlers.onOpen(item),
  },
  media(item, cat?.emoji, 'mini-media'),
  badge || null,
  h('span', { class: 'mini-name' }, item.name),
  h('span', { class: 'price mini-price' }, formatPrice(item.price, state.settings?.currency_symbol)),
  );
}

export function renderRails(state, handlers) {
  const now = Date.now();
  const fresh = [...state.items.values()]
    .filter((it) => isFresh(it, now) && state.categories.some((c) => c.id === it.category_id))
    .sort((a, b) => new Date(b.last_restocked_at) - new Date(a.last_restocked_at))
    .slice(0, 10);

  const freshSection = $('#fresh');
  const freshRail = $('#fresh-rail');
  clear(freshRail);
  freshSection.hidden = fresh.length === 0;
  for (const item of fresh) {
    freshRail.appendChild(miniCard(item, state, handlers, { badge: h('span', { class: 'just-in' }, 'Just in') }));
  }

  const popularSection = $('#popular');
  const popularRail = $('#popular-rail');
  clear(popularRail);
  const popular = state.popular.map((id) => state.items.get(id)).filter(Boolean);
  popularSection.hidden = popular.length < 3;
  popular.forEach((item, i) => {
    popularRail.appendChild(miniCard(item, state, handlers, { badge: h('span', { class: 'rank' }, `#${i + 1}`) }));
  });
}

/* ------------------------------------------------------------------ */
/* Item detail sheet                                                   */
/* ------------------------------------------------------------------ */

let openDetail = null; // { id, render }

export function openItemSheet(item, state, handlers) {
  let qty = 1;
  const sheet = openSheet({
    title: item.name,
    hideTitle: true,
    variant: 'bottom',
    className: 'item-sheet',
    onClose: () => { openDetail = null; },
  });

  const render = (current) => {
    const cat = state.categories.find((c) => c.id === current.category_id);
    const currency = state.settings?.currency_symbol || '₹';
    const s = itemState(current);
    sheet.setTitle(current.name);
    clear(sheet.body);

    let availability;
    if (s.soldOut) availability = h('div', { class: 'availability is-soldout' }, icon('x', { size: 18 }), h('span', {}, h('strong', {}, 'Sold out right now. '), 'Please choose something else, or check back soon.'));
    else if (s.unavailable) availability = h('div', { class: 'availability is-later' }, icon('clock', { size: 18 }), h('span', {}, h('strong', {}, `${s.windowLabel}. `), current.available_to ? `Served ${formatClock(current.available_from)} – ${formatClock(current.available_to)}.` : ''));
    else if (s.low) availability = h('div', { class: 'availability is-low' }, icon('alert', { size: 18 }), h('span', {}, h('strong', {}, 'Only a few left. '), 'Order soon!'));
    else availability = h('div', { class: 'availability is-ok' }, icon('check', { size: 18 }), h('span', {}, h('strong', {}, s.fresh ? 'Fresh & available. ' : 'Available now. '), 'Order at the counter.'));

    const mediaEl = media(current, cat?.emoji, 'sheet-media');
    if (s.soldOut) mediaEl.appendChild(h('span', { class: 'ribbon' }, 'Sold out'));

    sheet.body.append(
      mediaEl,
      h('div', { class: 'sheet-item-head' },
        h('div', { class: 'item-title-row' },
          h('span', { class: `veg-mark ${current.is_veg ? 'is-veg' : 'is-nonveg'}`, role: 'img', 'aria-label': current.is_veg ? 'Vegetarian' : 'Non-vegetarian' }),
          h('h3', { class: 'sheet-item-name display', 'aria-hidden': 'true' }, current.name),
        ),
        h('span', { class: 'price sheet-item-price' }, formatPrice(current.price, currency)),
      ),
      tagBadges(current, { fresh: s.fresh }),
      current.description ? h('p', { class: 'sheet-item-desc' }, current.description) : null,
      availability,
    );

    const canAdd = !s.soldOut && !s.unavailable;
    const addLabel = h('span', { class: 'btn-label' });
    const paintLabel = () => {
      clear(addLabel);
      if (canAdd) addLabel.append('Add', h('span', { class: 'sr-only' }, ' to My Picks'), ` · ${formatPrice(current.price * qty, currency)}`);
      else addLabel.textContent = s.soldOut ? 'Sold out right now' : s.windowLabel;
    };
    const step = stepper({ value: qty, min: 1, max: 20, label: 'quantity', size: 'lg', onChange: (v) => { qty = v; paintLabel(); } });
    const addBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary btn-lg add-cta',
      disabled: !canAdd,
      onClick: () => {
        handlers.onAddQty(current, qty);
        sheet.close('added');
      },
    }, icon('plus', { size: 18 }), addLabel);
    paintLabel();
    sheet.setFooter(h('div', { class: 'sheet-add-row' }, canAdd ? step : null, addBtn));
  };

  render(item);
  openDetail = { id: item.id, render };
  return sheet;
}

/** Re-render the open item sheet if it shows this item. */
export function refreshOpenSheet(item) {
  if (openDetail && item && openDetail.id === item.id) openDetail.render(item);
}

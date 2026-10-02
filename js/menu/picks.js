// "My Picks": a show-at-the-counter list. Lives only in sessionStorage —
// nothing is sent to the server, there is no ordering or payment.

import { h, icon, clear, openSheet, stepper, toast, announce, $, prefersReducedMotion } from '../lib/ui.js';
import { formatPrice, plural } from '../lib/format.js';
import { itemState } from './render.js';

const KEY = 'chaimenu:picks';

function load() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ getItem: (id: string) => object|undefined, getCurrency: () => string, table: number|null, onChange: () => void }} opts
 */
export function createPicks({ getItem, getCurrency, table, onChange }) {
  let picks = load(); // { itemId: qty }
  let counter = null; // open counter sheet

  const save = () => {
    try { sessionStorage.setItem(KEY, JSON.stringify(picks)); } catch { /* storage full/private */ }
  };

  const qty = (id) => picks[id] || 0;

  const entries = () => Object.entries(picks)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, qty: n, item: getItem(id) }));

  /** Only items that can actually be ordered count towards the total. */
  const summary = () => {
    let count = 0;
    let total = 0;
    for (const e of entries()) {
      if (!e.item) continue;
      const s = itemState(e.item);
      if (s.soldOut || s.unavailable) continue;
      count += e.qty;
      total += Number(e.item.price) * e.qty;
    }
    return { count, total, lines: entries().length };
  };

  const set = (id, n, { silent = false } = {}) => {
    if (n <= 0) delete picks[id];
    else picks[id] = Math.min(20, n);
    save();
    paintPill(!silent);
    if (counter) renderCounter();
    onChange && onChange(id);
  };

  const add = (item, n = 1) => {
    set(item.id, qty(item.id) + n);
    announce(`${item.name} added. ${plural(summary().count, 'item')} in My Picks.`);
  };

  /* ---------------- Floating pill ---------------- */

  const pill = $('#picks-pill');
  pill.addEventListener('click', () => openCounter());

  function paintPill(bump = false) {
    const { count, total, lines } = summary();
    if (lines === 0) {
      pill.hidden = true;
      document.body.classList.remove('has-picks');
      return;
    }
    pill.hidden = false;
    document.body.classList.add('has-picks');
    clear(pill).append(
      h('span', { class: 'picks-icon', 'aria-hidden': 'true' }, icon('bag', { size: 18 })),
      h('span', { class: 'picks-text' },
        count ? `${plural(count, 'item')} · ` : 'My Picks · ',
        h('span', { class: 'price' }, count ? formatPrice(total, getCurrency()) : 'needs a change'),
      ),
      icon('arrowRight', { size: 18 }),
    );
    pill.setAttribute('aria-label', `My Picks: ${plural(count, 'item')}, total ${formatPrice(total, getCurrency())}. Open counter view`);
    if (bump && !prefersReducedMotion()) {
      pill.classList.remove('bump');
      void pill.offsetWidth; // restart the animation
      pill.classList.add('bump');
    }
  }

  /* ---------------- Counter view ---------------- */

  function openCounter() {
    if (counter) return;
    counter = openSheet({
      title: 'My Picks',
      variant: 'full',
      className: 'counter-sheet',
      onClose: () => { counter = null; },
    });
    renderCounter();
  }

  function renderCounter() {
    const body = counter.body;
    const currency = getCurrency();
    // Re-rendering replaces the steppers; remember which control had focus.
    const active = document.activeElement;
    const focusLabel = active && body.contains(active) ? active.getAttribute('aria-label') : null;
    const scrollTop = body.scrollTop;
    clear(body);
    const restoreFocus = () => {
      body.scrollTop = scrollTop;
      if (!focusLabel) return;
      const target = Array.from(body.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === focusLabel && !b.disabled);
      (target || counter.dialog.querySelector('.sheet-close')).focus({ preventScroll: true });
    };
    const list = entries();

    body.appendChild(h('div', { class: 'counter-head' },
      h('p', { class: 'counter-kicker' }, 'Show this at the counter'),
      table ? h('p', { class: 'counter-table display' }, `Table ${table}`) : null,
    ));

    if (!list.length) {
      body.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🫖'),
        h('h3', { class: 'empty-title' }, 'Your list is empty'),
        h('p', { class: 'empty-msg' }, 'Tap “+” on anything you like, then show this screen at the counter.'),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => counter.close() }, 'Browse the menu'),
      ));
      counter.setFooter(null);
      restoreFocus();
      return;
    }

    const ul = h('ul', { class: 'counter-list' });
    for (const { id, qty: n, item } of list) {
      if (!item) {
        ul.appendChild(h('li', { class: 'counter-row is-gone' },
          h('div', { class: 'counter-main' },
            h('p', { class: 'counter-name' }, 'Item no longer on the menu'),
            h('p', { class: 'counter-warn' }, icon('alert', { size: 16 }), 'Please choose another'),
          ),
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Remove', onClick: () => set(id, 0) }, icon('trash', { size: 18 })),
        ));
        continue;
      }
      const s = itemState(item);
      const blocked = s.soldOut || s.unavailable;
      ul.appendChild(h('li', { class: `counter-row ${blocked ? 'is-blocked' : ''}` },
        h('div', { class: 'counter-main' },
          h('p', { class: 'counter-name' },
            h('span', { class: `veg-mark ${item.is_veg ? 'is-veg' : 'is-nonveg'}`, role: 'img', 'aria-label': item.is_veg ? 'Vegetarian' : 'Non-vegetarian' }),
            h('span', {}, item.name),
          ),
          blocked
            ? h('p', { class: 'counter-warn', role: 'status' }, icon('alert', { size: 16 }), s.soldOut ? 'Sold out — please choose another' : `${s.windowLabel} — please choose another`)
            : h('p', { class: 'counter-price price' }, `${n} × ${formatPrice(item.price, currency)} = ${formatPrice(item.price * n, currency)}`),
        ),
        stepper({ value: n, min: 0, max: 20, label: item.name, onChange: (v) => set(id, v) }),
      ));
    }
    body.appendChild(ul);

    const { count, total } = summary();
    body.appendChild(h('div', { class: 'counter-total' },
      h('span', {}, `Total · ${plural(count, 'item')}`),
      h('span', { class: 'price display' }, formatPrice(total, currency)),
    ));
    body.appendChild(h('p', { class: 'counter-note' }, 'Order & pay at the counter 🙏 Prices are for reference.'));

    counter.setFooter(h('div', { class: 'counter-actions' },
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-lg',
        onClick: () => {
          const snapshot = { ...picks };
          picks = {};
          save();
          paintPill();
          renderCounter();
          onChange && onChange(null);
          toast('My Picks cleared', {
            type: 'info',
            action: { label: 'Undo', onClick: () => { picks = snapshot; save(); paintPill(); if (counter) renderCounter(); onChange && onChange(null); } },
          });
        },
      }, icon('trash', { size: 18 }), 'Clear'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => counter.close() }, 'Add more'),
    ));
    restoreFocus();
  }

  paintPill();

  return {
    qty,
    add,
    set,
    open: openCounter,
    /** Call after live menu changes so warnings and totals stay true. */
    refresh() {
      paintPill();
      if (counter) renderCounter();
    },
  };
}

// Overview tab — "What's happening now": KPIs, live stock activity, top
// viewed items, scans by hour (inline SVG, no chart library) and the
// quick actions the owner needs at opening and closing time.

import { store, subscribe, getItem, emojiFor, setStockBulk, updateSettings } from './store.js';
import { sb, run } from '../lib/supabase.js';
import { h, icon, clear, toast, confirmDialog, button, setBusy, skeleton } from '../lib/ui.js';
import { formatTimeOfDay, timeAgo, plural, formatMinutes } from '../lib/format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
};

export function mount(panel) {
  let stats = null;
  let feed = [];
  let timer = null;

  /* ---------------- Layout ---------------- */

  const dateLine = h('p', { class: 'panel-sub' });
  const kpis = h('div', { class: 'kpi-grid' });
  const feedList = h('ol', { class: 'feed', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const topList = h('ol', { class: 'bars' });
  const chart = h('div', { class: 'chart' });

  const annIn = h('input', { class: 'input', id: 'ov-announcement', maxlength: 120, placeholder: 'e.g. Hot samosas at 5 PM 🔥', autocomplete: 'off' });
  const annSave = button('Save', { variant: 'primary', type: 'submit' });
  const annClear = button('Clear', { variant: 'ghost' });
  const startDay = button('Start the day', { icon: 'sunrise', variant: 'accent', size: 'lg' });
  const openClose = button('Close shop', { icon: 'power', variant: 'secondary', size: 'lg' });

  panel.append(
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'panel-title display', id: 'h-overview' }, 'What’s happening now'),
        dateLine,
      ),
    ),
    kpis,
    h('div', { class: 'card pad quick' },
      h('h3', { class: 'card-title' }, icon('megaphone', { size: 18 }), 'Quick actions'),
      h('form', { class: 'ann-form', novalidate: true, onSubmit: (e) => { e.preventDefault(); saveAnnouncement(); } },
        h('label', { class: 'field-label', for: 'ov-announcement' }, 'Announcement on the menu'),
        h('div', { class: 'ann-row' }, annIn, annSave, annClear),
      ),
      h('div', { class: 'quick-row' }, startDay, openClose),
    ),
    h('div', { class: 'overview-grid' },
      h('section', { class: 'card pad', 'aria-labelledby': 'ov-feed' },
        h('h3', { class: 'card-title', id: 'ov-feed' }, icon('activity', { size: 18 }), 'Live stock activity'),
        feedList,
      ),
      h('div', { class: 'overview-col' },
        h('section', { class: 'card pad', 'aria-labelledby': 'ov-hours' },
          h('h3', { class: 'card-title', id: 'ov-hours' }, icon('scan', { size: 18 }), 'Scans by hour today'),
          chart,
        ),
        h('section', { class: 'card pad', 'aria-labelledby': 'ov-top' },
          h('h3', { class: 'card-title', id: 'ov-top' }, icon('trendUp', { size: 18 }), 'Most viewed this week'),
          topList,
        ),
      ),
    ),
  );

  annClear.addEventListener('click', () => { annIn.value = ''; saveAnnouncement(); });
  startDay.addEventListener('click', startTheDay);
  openClose.addEventListener('click', toggleOpen);

  /* ---------------- KPIs ---------------- */

  function kpi(label, value, sub, { tone = '', iconName } = {}) {
    return h('div', { class: `kpi card ${tone}` },
      h('p', { class: 'kpi-label' }, iconName ? icon(iconName, { size: 16 }) : null, label),
      h('p', { class: 'kpi-value display tabular' }, value),
      sub ? h('p', { class: 'kpi-sub' }, sub) : null,
    );
  }

  function renderKpis() {
    clear(kpis);
    const total = store.items.length;
    const inStock = store.items.filter((i) => i.in_stock).length;
    const soldOut = total - inStock;

    if (!stats) {
      kpis.append(...Array.from({ length: 4 }, () => h('div', { class: 'kpi card' }, skeleton('sk-kpi-label'), skeleton('sk-kpi-value'))));
    } else {
      const diff = stats.scans_today - stats.scans_yesterday;
      const trend = stats.scans_yesterday === 0 && stats.scans_today === 0
        ? 'No scans yet today'
        : h('span', { class: `trend ${diff >= 0 ? 'is-up' : 'is-down'}` }, icon(diff >= 0 ? 'trendUp' : 'trendDown', { size: 14 }), `${diff >= 0 ? '+' : ''}${diff} vs yesterday`);
      kpis.append(kpi('Scans today', String(stats.scans_today), trend, { iconName: 'scan' }));
    }
    kpis.append(kpi('In stock', `${inStock}/${total}`, total ? `${Math.round((inStock / total) * 100)}% of the menu` : 'No items yet', { iconName: 'package' }));
    kpis.append(kpi('Sold out', String(soldOut), soldOut ? h('a', { href: '#stock' }, 'Manage stock →') : 'Everything available 🎉', { tone: soldOut ? 'is-danger' : 'is-success', iconName: 'alert' }));
    if (stats) {
      const busy = stats.busiest_table;
      kpis.append(kpi('Busiest table', busy ? `T${busy.table_number}` : '—', busy ? plural(busy.scans, 'scan') + ' today' : 'No table scans yet', { iconName: 'table' }));
    }
  }

  /* ---------------- Charts ---------------- */

  function renderChart() {
    clear(chart);
    const data = stats?.scans_by_hour || Array(24).fill(0);
    const max = Math.max(1, ...data);
    const total = data.reduce((a, b) => a + b, 0);
    const peak = data.indexOf(Math.max(...data));
    const nowHour = new Date().getHours();
    const W = 240;
    const H = 96;
    const bw = 7;
    const step = W / 24;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H + 16}`, class: 'chart-svg', role: 'img', 'aria-label': total ? `${plural(total, 'scan')} today. Busiest hour: ${formatMinutes(peak * 60)} with ${data[peak]}.` : 'No scans yet today.' });
    root.appendChild(svg('line', { x1: 0, x2: W, y1: H, y2: H, class: 'chart-axis' }));
    data.forEach((v, hour) => {
      const bh = v ? Math.max(3, (v / max) * (H - 8)) : 1.5;
      const rect = svg('rect', {
        x: hour * step + (step - bw) / 2, y: H - bh, width: bw, height: bh, rx: 2,
        class: hour === nowHour ? 'bar is-now' : v === data[peak] && v > 0 ? 'bar is-peak' : 'bar',
      }, svg('title', {}, `${formatMinutes(hour * 60)}: ${plural(v, 'scan')}`));
      root.appendChild(rect);
    });
    for (const hour of [0, 6, 12, 18]) {
      root.appendChild(svg('text', { x: hour * step + step / 2, y: H + 13, class: 'chart-label', 'text-anchor': 'middle' }, formatMinutes(hour * 60).replace(' ', '')));
    }
    chart.appendChild(root);
    if (!total) chart.appendChild(h('p', { class: 'muted small' }, 'Scans appear here as customers open the menu.'));
  }

  function renderTop() {
    clear(topList);
    const top = stats?.top_items || [];
    if (!stats) { topList.append(skeleton('sk-bar'), skeleton('sk-bar'), skeleton('sk-bar')); return; }
    if (!top.length) { topList.appendChild(h('li', { class: 'muted small' }, 'No item views yet this week. Views are counted when customers open an item.')); return; }
    const max = Math.max(...top.map((t) => t.views));
    for (const t of top) {
      const item = getItem(t.item_id);
      topList.appendChild(h('li', { class: 'bar-row' },
        h('span', { class: 'bar-name' }, h('span', { 'aria-hidden': 'true' }, item ? emojiFor(item) : '🍽️'), ' ', t.name),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { width: `${Math.max(4, (t.views / max) * 100)}%` } })),
        h('span', { class: 'bar-value tabular' }, plural(t.views, 'view')),
      ));
    }
  }

  /* ---------------- Feed ---------------- */

  function feedText(ev) {
    const item = getItem(ev.item_id);
    const name = item?.name || ev.menu_items?.name || 'An item';
    if (ev.event === 'restocked') return { emoji: item ? emojiFor(item) : '✅', text: `${name} restocked`, tone: 'is-in' };
    if (ev.event === 'stock_out') return { emoji: '🚫', text: `${name} sold out`, tone: 'is-out' };
    return { emoji: '🔢', text: `${name} quantity → ${ev.qty ?? 0}`, tone: 'is-qty' };
  }

  function renderFeed() {
    clear(feedList);
    if (!feed.length) {
      feedList.appendChild(h('li', { class: 'muted small feed-empty' }, 'Nothing yet today. When you mark something sold out or restocked, it shows up here.'));
      return;
    }
    for (const ev of feed.slice(0, 25)) {
      const { emoji, text, tone } = feedText(ev);
      feedList.appendChild(h('li', { class: `feed-row ${tone}` },
        h('span', { class: 'feed-emoji', 'aria-hidden': 'true' }, emoji),
        h('span', { class: 'feed-text' }, text),
        h('time', { class: 'feed-time tabular', datetime: ev.created_at, title: timeAgo(ev.created_at) }, formatTimeOfDay(ev.created_at)),
      ));
    }
  }

  /* ---------------- Data ---------------- */

  async function loadStats() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    const res = await run(() => sb.rpc('admin_stats', { tz }), { action: 'load today’s numbers', silent: !!stats });
    if (res.data) {
      stats = res.data;
      renderKpis();
      renderChart();
      renderTop();
    }
  }

  async function loadFeed() {
    const res = await run(
      () => sb.from('stock_events').select('id,item_id,event,qty,created_at,menu_items(name)').order('created_at', { ascending: false }).limit(25),
      { action: 'load stock activity', silent: true },
    );
    if (res.data) {
      feed = res.data;
      renderFeed();
    }
  }

  /* ---------------- Quick actions ---------------- */

  function paintQuick() {
    if (document.activeElement !== annIn) annIn.value = store.settings?.announcement || '';
    const open = !!store.settings?.is_open;
    clear(openClose).append(icon(open ? 'power' : 'store', { size: 18 }), h('span', { class: 'btn-label' }, open ? 'Close shop' : 'Open shop'));
    openClose.dataset.labelText = open ? 'Close shop' : 'Open shop';
    dateLine.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      + (open ? ' · Shop is open' : ' · Shop is closed');
  }

  async function saveAnnouncement() {
    const value = annIn.value.trim() || null;
    if (value === (store.settings?.announcement || null)) { toast('Announcement unchanged', { type: 'info', duration: 1500 }); return; }
    setBusy(annSave, true);
    const res = await updateSettings({ announcement: value }, { action: 'save the announcement' });
    setBusy(annSave, false);
    if (!res.error) toast(value ? 'Announcement is live on the menu' : 'Announcement cleared', { type: 'success', emoji: '📣' });
  }

  async function startTheDay() {
    const out = store.items.filter((i) => !i.in_stock).map((i) => i.id);
    const ok = await confirmDialog({
      title: 'Start the day?',
      message: `${out.length ? `${plural(out.length, 'sold-out item')} will be marked in stock` : 'Everything is already in stock'}, the announcement will be cleared and the shop set to Open.`,
      confirmLabel: 'Start the day',
      icon: 'sunrise',
    });
    if (!ok) return;
    setBusy(startDay, true);
    const [stock, settings] = await Promise.all([
      setStockBulk(out, true, { action: 'restock everything' }),
      updateSettings({ announcement: null, is_open: true }, { action: 'reset the announcement' }),
    ]);
    setBusy(startDay, false);
    if (!stock.error && !settings.error) toast('Good morning! Everything is in stock and the shop is open ☀️', { type: 'success' });
  }

  async function toggleOpen() {
    const open = !!store.settings?.is_open;
    if (open) {
      const ok = await confirmDialog({
        title: 'Close the shop?',
        message: 'Customers will see “Closed” on the menu until you open again. Stock is not changed.',
        confirmLabel: 'Close shop',
        icon: 'power',
      });
      if (!ok) return;
    }
    setBusy(openClose, true);
    const res = await updateSettings({ is_open: !open }, { action: open ? 'close the shop' : 'open the shop' });
    setBusy(openClose, false);
    if (!res.error) toast(open ? 'Shop closed. Good night! 🌙' : 'Shop is open 🟢', { type: 'success' });
  }

  /* ---------------- Wiring ---------------- */

  subscribe((e) => {
    if (e.type === 'stock_event') {
      feed.unshift(e.event);
      renderFeed();
    }
    if (['item', 'items', 'item_removed', 'loaded'].includes(e.type)) renderKpis();
    if (e.type === 'settings' || e.type === 'loaded') paintQuick();
  });

  renderKpis();
  renderChart();
  renderTop();
  renderFeed();
  paintQuick();

  return {
    show() {
      loadStats();
      loadFeed();
      clearInterval(timer);
      timer = setInterval(loadStats, 60 * 1000);
    },
    hide() {
      clearInterval(timer);
    },
  };
}

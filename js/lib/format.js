// Formatting and time logic shared by the customer menu and dashboard.
// Times from Postgres arrive as "HH:MM:SS" strings in shop-local time.

export const FRESH_WINDOW_MS = 2 * 60 * 60 * 1000; // "Fresh right now" = restocked < 2 h ago
export const LOW_STOCK_AT = 3;

/** ₹25 / ₹25.50 — drops ".00" so prices stay short on small screens. */
export function formatPrice(value, symbol = '₹') {
  const n = Number(value) || 0;
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  const num = n.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${symbol}${num}`;
}

/** "16:30:00" → minutes since midnight (990). null when empty. */
export function timeToMinutes(time) {
  if (!time) return null;
  const [hh, mm] = String(time).split(':').map(Number);
  if (Number.isNaN(hh)) return null;
  return hh * 60 + (mm || 0);
}

export const minutesNow = (now = new Date()) => now.getHours() * 60 + now.getMinutes();

/** "16:00:00" → "4 PM", "16:30:00" → "4:30 PM". */
export function formatClock(time) {
  const mins = timeToMinutes(time);
  if (mins === null) return '';
  return formatMinutes(mins);
}

export function formatMinutes(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

/** Date → "4:12 PM". */
export function formatTimeOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return formatMinutes(d.getHours() * 60 + d.getMinutes());
}

/** Is `now` inside [from, to)? Handles windows that cross midnight. */
export function inWindow(nowMin, fromMin, toMin) {
  if (fromMin === null && toMin === null) return true;
  if (fromMin === null) return nowMin < toMin;
  if (toMin === null) return nowMin >= fromMin;
  if (fromMin === toMin) return true; // treat as all day
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin;
  return nowMin >= fromMin || nowMin < toMin; // overnight, e.g. 18:00 → 02:00
}

/**
 * Shop status from hours + the owner's manual switch.
 * The manual switch can close the shop early; hours decide the rest.
 */
export function getShopStatus(settings, now = new Date()) {
  if (!settings) return { open: false, label: '', tone: 'muted' };
  const open = timeToMinutes(settings.open_time);
  const close = timeToMinutes(settings.close_time);
  const withinHours = inWindow(minutesNow(now), open, close);

  if (settings.is_open && withinHours) {
    return { open: true, tone: 'success', label: close !== null ? `Open · closes ${formatMinutes(close)}` : 'Open now' };
  }
  if (!settings.is_open && withinHours) {
    return { open: false, tone: 'danger', label: 'Closed for now' };
  }
  return { open: false, tone: 'danger', label: open !== null ? `Closed · opens ${formatMinutes(open)}` : 'Closed' };
}

/** Is the item inside its daily serving window right now? */
export function getItemWindow(item, now = new Date()) {
  const from = timeToMinutes(item.available_from);
  const to = timeToMinutes(item.available_to);
  if (from === null && to === null) return { available: true, label: '' };
  if (inWindow(minutesNow(now), from, to)) return { available: true, label: '' };
  if (from !== null) return { available: false, label: `Available from ${formatMinutes(from)}` };
  return { available: false, label: 'Not available now' };
}

export function isFresh(item, now = Date.now()) {
  if (!item.in_stock || !item.last_restocked_at) return false;
  const t = new Date(item.last_restocked_at).getTime();
  return now - t >= 0 && now - t < FRESH_WINDOW_MS;
}

export function isLowStock(item) {
  return !!(item.in_stock && item.track_qty && item.stock_qty !== null && item.stock_qty > 0 && item.stock_qty <= LOW_STOCK_AT);
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function timeAgo(date, now = Date.now()) {
  const diff = Math.max(0, now - new Date(date).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

/** "HH:MM" for <input type="time"> from "HH:MM:SS". */
export const toInputTime = (time) => (time ? String(time).slice(0, 5) : '');

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Stable small hash → used to pick a placeholder gradient per item. */
export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const TAG_LABELS = {
  bestseller: { label: 'Bestseller', emoji: '⭐' },
  new: { label: 'New', emoji: '✨' },
  spicy: { label: 'Spicy', emoji: '🌶️' },
  must_try: { label: 'Must try', emoji: '💛' },
};

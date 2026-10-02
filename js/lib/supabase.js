// Supabase client, the one error-handling wrapper every call goes through,
// and the queries shared between pages.

import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET } from '../config.js';
import { toast } from './ui.js';

export const isConfigured =
  /^https:\/\/.+\.supabase\.(co|in)\/?$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('YOUR-');

// Loaded dynamically so a cached menu can still render if the CDN is
// unreachable (e.g. the phone just lost signal).
let createClient = null;
let loadError = null;
try {
  ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
} catch (err) {
  loadError = err;
}

export const sb = isConfigured && createClient
  ? createClient(SUPABASE_URL.replace(/\/$/, ''), SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'chaimenu-auth' },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export function clientProblem() {
  if (!isConfigured) return 'ChaiMenu isn’t connected to a database yet. Add your Supabase URL and anon key to js/config.js.';
  if (!sb) return loadError ? 'Couldn’t load the app’s database library. Check your internet connection and try again.' : 'Database unavailable.';
  return null;
}

/** Turn any Supabase/network error into one plain sentence with a next step. */
export function friendlyError(error, action = 'complete that') {
  const msg = String(error?.message || error || '');
  const code = error?.code || error?.statusCode || error?.status;

  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'You’re offline. Check your internet connection and try again.';
  }
  if (code === '42501' || /row-level security|permission denied|not authorized|Unauthorized/i.test(msg)) {
    return 'Permission denied. This account isn’t set up as the shop owner — see README → “permission denied”.';
  }
  if (/JWT expired|invalid JWT|refresh token/i.test(msg) || code === 401 || code === '401') {
    return 'Your session expired. Please log in again.';
  }
  if (code === '23505') return 'That already exists. Try a different value.';
  if (/Payload too large|exceeded the maximum allowed size|413/i.test(msg)) return 'That image is too big (max 2 MB). Try a smaller photo.';
  if (/Bucket not found/i.test(msg)) return 'Photo storage isn’t set up yet. Run supabase/schema.sql again.';
  if (/mime type|invalid_mime/i.test(msg)) return 'Only JPEG, PNG or WebP images can be uploaded.';
  if (/relation .* does not exist|Could not find the (table|function)/i.test(msg)) {
    return 'The database isn’t set up yet. Run supabase/schema.sql in the Supabase SQL Editor.';
  }
  return `Couldn’t ${action}. ${msg ? msg.replace(/\.$/, '') + '.' : 'Please try again.'}`;
}

/**
 * Run a Supabase query (builder, promise or function returning one).
 * Never throws: returns { data, error, count }. Shows a friendly toast on
 * failure unless `silent`, with a Retry button when `retry` is given.
 */
export async function run(query, { action = 'load data', silent = false, retry } = {}) {
  const problem = clientProblem();
  if (problem) {
    const error = new Error(problem);
    if (!silent) toast(problem, { type: 'error' });
    return { data: null, error, count: null };
  }
  try {
    const res = await (typeof query === 'function' ? query() : query);
    if (res && res.error) throw res.error;
    return { data: res ? res.data : null, error: null, count: res ? res.count : null };
  } catch (error) {
    if (!silent) {
      toast(friendlyError(error, action), {
        type: 'error',
        duration: retry ? 9000 : 6000,
        action: retry ? { label: 'Retry', onClick: retry } : undefined,
      });
    }
    return { data: null, error, count: null };
  }
}

/* ------------------------------------------------------------------ */
/* Shared queries                                                      */
/* ------------------------------------------------------------------ */

export const ITEM_COLUMNS =
  'id,category_id,name,description,price,image_url,is_veg,tags,in_stock,track_qty,stock_qty,available_from,available_to,last_restocked_at,last_stockout_at,sort_order,is_visible,updated_at';

/** Customer menu in ONE request: visible categories with their visible items, in order. */
export function fetchMenu(opts) {
  return run(
    () => sb
      .from('categories')
      .select(`id,name,emoji,sort_order,is_visible,menu_items(${ITEM_COLUMNS})`)
      .eq('is_visible', true)
      .eq('menu_items.is_visible', true)
      .order('sort_order', { ascending: true })
      .order('sort_order', { ascending: true, referencedTable: 'menu_items' }),
    { action: 'load the menu', ...opts },
  );
}

export function fetchSettings(opts) {
  return run(() => sb.from('shop_settings').select('*').eq('id', 1).maybeSingle(), { action: 'load shop details', ...opts });
}

export function fetchPopular(opts) {
  return run(() => sb.rpc('popular_items', { days: 7, lim: 6 }), { action: 'load popular items', silent: true, ...opts });
}

/* ------------------------------------------------------------------ */
/* Anonymous analytics — rate limited on the client                    */
/* ------------------------------------------------------------------ */

function onceThisSession(key) {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}

export function logScan(tableNumber) {
  if (!sb || !onceThisSession('chaimenu:scan-logged')) return;
  run(() => sb.from('scans').insert({ table_number: tableNumber || null }), { silent: true });
}

export function logView(itemId) {
  if (!sb || !itemId || !onceThisSession(`chaimenu:view:${itemId}`)) return;
  run(() => sb.from('item_views').insert({ item_id: itemId }), { silent: true });
}

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Upload a processed image Blob; resolves to its public URL. */
export async function uploadImage(blob, folder = 'items') {
  if (!ALLOWED_TYPES.includes(blob.type)) return { data: null, error: new Error('Only JPEG, PNG or WebP images can be uploaded.') };
  if (blob.size > MAX_UPLOAD_BYTES) return { data: null, error: new Error('That image is too big (max 2 MB).') };
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const res = await run(
    () => sb.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }),
    { action: 'upload the photo' },
  );
  if (res.error) return res;
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { data: data.publicUrl, error: null };
}

/** Delete a previously uploaded image by its public URL (best effort). */
export async function deleteImageByUrl(url) {
  if (!url || !sb) return;
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return; // not ours (e.g. an external URL)
  const path = decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
  await run(() => sb.storage.from(STORAGE_BUCKET).remove([path]), { silent: true });
}

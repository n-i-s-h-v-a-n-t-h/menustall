// Live updates for the customer menu. Wraps a Supabase Realtime channel
// with reconnect logic: if the socket or channel drops we show
// "Reconnecting…", retry with backoff, and ask the page to re-sync
// (re-fetch) once we're back so nothing that changed meanwhile is missed.

import { sb } from '../lib/supabase.js';

/**
 * @param {{
 *   onItem: (row: object, type: string) => void,
 *   onItemDelete: (id: string) => void,
 *   onCategories: () => void,
 *   onSettings: (row: object) => void,
 *   onStatus: (status: 'live'|'reconnecting'|'offline') => void,
 *   onResync: () => void,
 * }} handlers
 */
export function connectRealtime(handlers) {
  if (!sb) return { stop() {} };

  let channel = null;
  let retryTimer = null;
  let attempt = 0;
  let wasDown = false;
  let stopped = false;

  const setDown = (status) => {
    wasDown = true;
    handlers.onStatus(status);
  };

  const subscribe = () => {
    clearTimeout(retryTimer);
    const old = channel;
    channel = null;
    if (old) sb.removeChannel(old); // its CLOSED callback is ignored below

    const ch = sb
      .channel(`menu-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, (payload) => {
        if (payload.eventType === 'DELETE') handlers.onItemDelete(payload.old?.id);
        else handlers.onItem(payload.new, payload.eventType);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => handlers.onCategories())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_settings' }, (payload) => {
        if (payload.new && payload.new.id) handlers.onSettings(payload.new);
      })
      .subscribe((status) => {
        if (stopped || ch !== channel) return; // stale channel
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          handlers.onStatus('live');
          if (wasDown) {
            wasDown = false;
            handlers.onResync();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setDown(navigator.onLine ? 'reconnecting' : 'offline');
          scheduleRetry();
        }
      });
    channel = ch;
  };

  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    if (stopped) return;
    // 1s, 2s, 4s … capped at 20s.
    const delay = Math.min(20000, 1000 * 2 ** attempt++);
    retryTimer = setTimeout(() => { if (navigator.onLine) subscribe(); else scheduleRetry(); }, delay);
  };

  window.addEventListener('offline', () => setDown('offline'));
  window.addEventListener('online', () => {
    handlers.onStatus('reconnecting');
    attempt = 0;
    subscribe();
  });

  // Phones freeze background tabs; after a long pause, re-sync.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 20000) {
      wasDown = true;
      subscribe();
    }
  });

  subscribe();

  return {
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      if (channel) sb.removeChannel(channel);
    },
  };
}

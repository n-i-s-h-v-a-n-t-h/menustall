// Settings tab: shop details, hours, logo, currency, QR base URL,
// announcement, password, and the danger zone.

import { store, subscribe, updateSettings, isLocalUrl, menuBaseUrl } from './store.js';
import { sb, run, uploadImage, deleteImageByUrl, friendlyError } from '../lib/supabase.js';
import { h, icon, clear, toast, confirmDialog, button, setBusy } from '../lib/ui.js';
import { toInputTime } from '../lib/format.js';
import { pickImageFile, cropImage } from './image-tools.js';

export function mount(panel) {
  let dirty = false;
  let pendingLogo = null; // Blob
  let pendingLogoUrl = null;
  let removeLogo = false;

  /* ---------------- Shop form ---------------- */

  const err = (id) => h('p', { class: 'field-error', id: `${id}-error` });
  const nameIn = h('input', { class: 'input', id: 'set-name', maxlength: 60, required: true, autocomplete: 'organization', 'aria-describedby': 'set-name-error' });
  const taglineIn = h('input', { class: 'input', id: 'set-tagline', maxlength: 80 });
  const openIn = h('input', { class: 'input', id: 'set-open', type: 'time' });
  const closeIn = h('input', { class: 'input', id: 'set-close', type: 'time' });
  const currencyIn = h('input', { class: 'input currency-input', id: 'set-currency', maxlength: 4, required: true, 'aria-describedby': 'set-currency-error' });
  const baseIn = h('input', { class: 'input', id: 'set-base', type: 'url', inputmode: 'url', placeholder: 'https://your-stall.netlify.app', autocomplete: 'off', 'aria-describedby': 'set-base-hint set-base-error' });
  const annIn = h('textarea', { class: 'textarea', id: 'set-ann', maxlength: 120, rows: 2, placeholder: 'e.g. Hot samosas at 5 PM 🔥' });
  const baseWarn = h('div', { class: 'notice notice-warning', role: 'status', hidden: true });
  const useThisSite = button('Use this site’s address', { icon: 'link', variant: 'ghost', size: 'sm' });

  const logoBox = h('div', { class: 'logo-box' });
  const logoChoose = button('Upload logo', { icon: 'upload', variant: 'secondary', size: 'sm' });
  const logoRemove = button('Remove', { icon: 'trash', variant: 'ghost', size: 'sm' });

  const saveBtn = button('Save changes', { icon: 'check', variant: 'primary', size: 'lg', type: 'submit' });
  const saveBar = h('div', { class: 'save-bar' }, h('span', { class: 'save-hint', role: 'status' }), saveBtn);

  const form = h('form', { class: 'card pad settings-form', novalidate: true },
    h('h3', { class: 'card-title' }, icon('store', { size: 18 }), 'Shop details'),
    h('div', { class: 'field' },
      h('p', { class: 'field-label', id: 'logo-label' }, 'Logo'),
      h('div', { class: 'photo-row', role: 'group', 'aria-labelledby': 'logo-label' }, logoBox, h('div', { class: 'photo-actions' }, logoChoose, logoRemove, h('p', { class: 'field-hint' }, 'Square works best. Shown on the menu and QR cards.'))),
    ),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-name' }, 'Shop name', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), nameIn, err('set-name')),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-tagline' }, 'Tagline'), taglineIn),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-open' }, 'Opens at'), openIn),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-close' }, 'Closes at'), closeIn),
    ),
    h('p', { class: 'field-hint' }, 'Customers see “Open · closes 10 PM” or “Closed · opens 6 AM”. The Open/Closed switch at the top can close early.'),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-currency' }, 'Currency symbol', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), currencyIn, err('set-currency')),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-ann' }, 'Announcement'), annIn, h('p', { class: 'field-hint' }, 'Shown as a bar at the top of the menu. Leave empty to hide.')),
    h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'set-base' }, 'QR base URL'),
      baseIn,
      h('p', { class: 'field-hint', id: 'set-base-hint' }, 'The web address of your live menu. QR codes open ', h('code', {}, '{this}/index.html?table=N'), '. Leave empty to use this site’s address.'),
      useThisSite,
      err('set-base'),
      baseWarn,
    ),
    saveBar,
  );

  /* ---------------- Password ---------------- */

  const pw1 = h('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', minlength: 8, 'aria-describedby': 'pw-new-error' });
  const pw2 = h('input', { class: 'input', id: 'pw-confirm', type: 'password', autocomplete: 'new-password', 'aria-describedby': 'pw-confirm-error' });
  const pwBtn = button('Change password', { icon: 'key', variant: 'secondary', type: 'submit' });
  const pwForm = h('form', { class: 'card pad', novalidate: true },
    h('h3', { class: 'card-title' }, icon('lock', { size: 18 }), 'Password'),
    h('input', { type: 'text', autocomplete: 'username', value: store.user?.email || '', hidden: true, 'aria-hidden': 'true', tabindex: '-1', readonly: true }),
    h('p', { class: 'muted small' }, `Logged in as ${store.user?.email || 'owner'}.`),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'pw-new' }, 'New password'), pw1, err('pw-new')),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'pw-confirm' }, 'Confirm'), pw2, err('pw-confirm')),
    ),
    pwBtn,
  );

  /* ---------------- Danger zone ---------------- */

  const resetBtn = button('Reset scan stats', { icon: 'trash', variant: 'danger-soft' });
  const danger = h('section', { class: 'card pad danger-zone', 'aria-labelledby': 'danger-title' },
    h('h3', { class: 'card-title', id: 'danger-title' }, icon('alert', { size: 18 }), 'Danger zone'),
    h('p', { class: 'muted small' }, 'Deletes all QR scan and item view statistics (the Overview numbers start from zero). Your menu, stock and tables are not touched.'),
    resetBtn,
  );

  panel.append(
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'panel-title display', id: 'h-settings' }, 'Settings'),
        h('p', { class: 'panel-sub' }, 'Your shop’s details, hours and QR address.'),
      ),
    ),
    h('div', { class: 'settings-grid' }, form, h('div', { class: 'settings-side' }, pwForm, danger)),
  );

  /* ---------------- Fill & paint ---------------- */

  const logoUrl = () => (removeLogo ? null : pendingLogoUrl || store.settings?.logo_url || null);

  function paintLogo() {
    clear(logoBox);
    const url = logoUrl();
    if (url) logoBox.appendChild(h('img', { src: url, alt: 'Shop logo', width: 72, height: 72 }));
    else logoBox.appendChild(h('span', { class: 'photo-empty', 'aria-hidden': 'true' }, '☕'));
    logoRemove.hidden = !url;
  }

  function paintBaseWarning() {
    const value = baseIn.value.trim();
    const effective = value || menuBaseUrl();
    clear(baseWarn);
    if (isLocalUrl(effective)) {
      baseWarn.hidden = false;
      baseWarn.append(icon('alert', { size: 18 }), h('span', {}, `QR codes would open ${effective}, which customers’ phones can’t reach. Enter your live website address.`));
    } else {
      baseWarn.hidden = true;
    }
  }

  function fill() {
    const s = store.settings || {};
    nameIn.value = s.shop_name || '';
    taglineIn.value = s.tagline || '';
    openIn.value = toInputTime(s.open_time);
    closeIn.value = toInputTime(s.close_time);
    currencyIn.value = s.currency_symbol || '₹';
    baseIn.value = s.base_url || '';
    annIn.value = s.announcement || '';
    paintLogo();
    paintBaseWarning();
    setDirty(false);
  }

  function setDirty(value) {
    dirty = value;
    saveBar.classList.toggle('is-dirty', value);
    saveBar.querySelector('.save-hint').textContent = value ? 'Unsaved changes' : 'All changes saved';
  }

  form.addEventListener('input', (e) => {
    setDirty(true);
    if (e.target === baseIn) paintBaseWarning();
  });

  useThisSite.addEventListener('click', () => {
    baseIn.value = new URL('../', location.href).href.replace(/\/+$/, '');
    setDirty(true);
    paintBaseWarning();
  });

  logoChoose.addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    const blob = await cropImage(file, { size: 400, maxBytes: 120 * 1024, title: 'Crop logo', round: true });
    if (!blob) return;
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    pendingLogo = blob;
    pendingLogoUrl = URL.createObjectURL(blob);
    removeLogo = false;
    setDirty(true);
    paintLogo();
  });
  logoRemove.addEventListener('click', () => {
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    pendingLogo = null;
    pendingLogoUrl = null;
    removeLogo = true;
    setDirty(true);
    paintLogo();
  });

  /* ---------------- Save ---------------- */

  const setError = (id, msg) => {
    const input = form.querySelector(`#${id}`) || pwForm.querySelector(`#${id}`);
    const el = panel.querySelector(`#${id}-error`);
    input?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (el) { clear(el); if (msg) el.append(icon('alert', { size: 14 }), msg); }
  };

  function normaliseBase(value) {
    let v = value.trim();
    if (!v) return { value: null };
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    try {
      const u = new URL(v);
      return { value: `${u.origin}${u.pathname}`.replace(/\/index\.html$/, '').replace(/\/+$/, '') };
    } catch {
      return { error: 'That doesn’t look like a web address. Example: https://my-stall.netlify.app' };
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    const cur = currencyIn.value.trim();
    const base = normaliseBase(baseIn.value);
    setError('set-name', name ? '' : 'Enter your shop name.');
    setError('set-currency', cur ? '' : 'Enter a currency symbol, like ₹.');
    setError('set-base', base.error || '');
    if (!name || !cur || base.error) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(saveBtn, true, 'Saving…');

    let newLogo = store.settings?.logo_url || null;
    const oldLogo = newLogo;
    if (pendingLogo) {
      const up = await uploadImage(pendingLogo, 'logo');
      if (up.error) { setBusy(saveBtn, false); return; }
      newLogo = up.data;
    } else if (removeLogo) {
      newLogo = null;
    }

    const res = await updateSettings({
      shop_name: name,
      tagline: taglineIn.value.trim() || null,
      open_time: openIn.value || null,
      close_time: closeIn.value || null,
      currency_symbol: cur,
      base_url: base.value,
      announcement: annIn.value.trim() || null,
      logo_url: newLogo,
    }, { action: 'save your settings' });
    setBusy(saveBtn, false);

    if (res.error) {
      if (pendingLogo && newLogo) deleteImageByUrl(newLogo);
      return;
    }
    if (oldLogo && oldLogo !== newLogo && !store.items.some((i) => i.image_url === oldLogo)) deleteImageByUrl(oldLogo);
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    pendingLogo = null;
    pendingLogoUrl = null;
    removeLogo = false;
    fill();
    toast('Settings saved', { type: 'success' });
  });

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('pw-new', pw1.value.length >= 8 ? '' : 'Use at least 8 characters.');
    setError('pw-confirm', pw1.value === pw2.value ? '' : 'Passwords don’t match.');
    if (pw1.value.length < 8 || pw1.value !== pw2.value) return;
    setBusy(pwBtn, true, 'Saving…');
    const { error } = await sb.auth.updateUser({ password: pw1.value });
    setBusy(pwBtn, false);
    if (error) { toast(friendlyError(error, 'change your password'), { type: 'error' }); return; }
    pw1.value = '';
    pw2.value = '';
    toast('Password changed', { type: 'success', emoji: '🔐' });
  });

  resetBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset scan stats?',
      message: 'All QR scan and item view statistics will be permanently deleted. This can’t be undone.',
      confirmLabel: 'Delete statistics',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    setBusy(resetBtn, true);
    const [a, b] = await Promise.all([
      run(() => sb.from('scans').delete().gte('id', 0), { action: 'reset scans' }),
      run(() => sb.from('item_views').delete().gte('id', 0), { action: 'reset item views' }),
    ]);
    setBusy(resetBtn, false);
    if (!a.error && !b.error) toast('Scan statistics reset', { type: 'success' });
  });

  subscribe((e) => {
    // Another device saved settings: refresh the form unless we're mid-edit.
    if ((e.type === 'settings' || e.type === 'loaded') && !dirty) fill();
  });

  fill();
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  return {};
}

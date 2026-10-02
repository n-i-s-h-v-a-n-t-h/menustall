// Owner authentication: the session guard used by every admin page,
// plus the login / forgot-password / set-new-password screen.

import { sb, clientProblem, friendlyError } from '../lib/supabase.js';
import { $, h, icon, clear, setBusy, toast, themeToggle } from '../lib/ui.js';

const LOGIN = 'login.html';

function goLogin(reason) {
  const next = location.pathname.endsWith('print.html') ? 'print' : location.hash.replace('#', '');
  location.replace(`${LOGIN}?reason=${reason}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
}

/**
 * Guard for admin pages. Resolves with the user when signed in AND listed
 * in `admins`; otherwise redirects to the login page with a clear reason.
 */
export async function requireAdmin() {
  if (clientProblem()) {
    goLogin('config');
    return new Promise(() => {}); // never resolves; we're navigating away
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    goLogin('signin');
    return new Promise(() => {});
  }

  // claim_ownership() returns true for an existing owner, and makes the
  // very first account the owner — no SQL needed during setup.
  let { data: isAdmin, error } = await sb.rpc('claim_ownership');
  if (error && /Could not find the function/i.test(error.message)) ({ data: isAdmin, error } = await sb.rpc('is_admin'));
  if (error && navigator.onLine) {
    if (/JWT|token/i.test(error.message)) {
      await sb.auth.signOut().catch(() => {});
      goLogin('expired');
      return new Promise(() => {});
    }
    toast(friendlyError(error, 'check your account'), { type: 'error' });
  } else if (!error && !isAdmin) {
    await sb.auth.signOut().catch(() => {});
    goLogin('notadmin');
    return new Promise(() => {});
  }

  sb.auth.onAuthStateChange((event) => {
    // Signed out on another tab/device (or the session expired).
    if (event === 'SIGNED_OUT' && !loggingOut) location.replace(`${LOGIN}?reason=signedout`);
  });
  return session.user;
}

let loggingOut = false;

export async function logout() {
  loggingOut = true;
  await sb.auth.signOut().catch(() => {});
  location.replace(`${LOGIN}?reason=signedout`);
}

/* ------------------------------------------------------------------ */
/* Login page                                                          */
/* ------------------------------------------------------------------ */

const REASONS = {
  signin: { type: 'info', text: 'Please log in to open the dashboard.' },
  notadmin: { type: 'error', text: 'This account isn’t the shop owner. Log in with the owner’s email, or ask the owner to add you (README → “Owner account”).' },
  setup: { type: 'error', text: 'The database isn’t set up yet. In Supabase, open SQL Editor, paste all of supabase/schema.sql and click Run (README step 2). Then reload this page.' },
  signedout: { type: 'info', text: 'You’ve been logged out. See you soon!' },
  expired: { type: 'info', text: 'Your session expired. Please log in again.' },
  reset: { type: 'success', text: 'Password updated. Please log in with your new password.' },
};

export function initLoginPage() {
  $('#theme-slot').appendChild(themeToggle());
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '';
  const banner = $('#login-banner');
  const forms = { login: $('#login-form'), signup: $('#signup-form'), forgot: $('#forgot-form'), recover: $('#recover-form') };

  const showBanner = (type, text) => {
    banner.hidden = !text;
    banner.className = `login-banner is-${type}`;
    clear(banner).append(icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info', { size: 18 }), h('span', {}, text));
  };

  const show = (name) => {
    for (const [key, form] of Object.entries(forms)) form.hidden = key !== name;
    const first = forms[name].querySelector('input');
    if (first) first.focus();
  };

  const destination = () => (next === 'print' ? 'print.html' : `index.html${next ? `#${next}` : ''}`);

  const problem = clientProblem();
  if (problem) {
    showBanner('error', problem);
    forms.login.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  const reason = REASONS[params.get('reason')];
  if (reason) showBanner(reason.type, reason.text);

  // Owner check that also makes the very first account the owner.
  const becomeOwner = async () => {
    let res = await sb.rpc('claim_ownership');
    if (res.error && /Could not find the function/i.test(res.error.message)) res = await sb.rpc('is_admin');
    return res;
  };

  // First run? If the shop has no owner yet, open "Create owner account".
  const isRecovery = /type=recovery/.test(location.hash);
  if (isRecovery) show('recover');
  sb.rpc('setup_status').then(({ data, error }) => {
    if (error) {
      if (/Could not find the function|does not exist|schema cache/i.test(error.message)) {
        showBanner('error', REASONS.setup.text);
        // Show the database's own words too, so problems are easy to report.
        banner.appendChild(h('small', { class: 'login-detail' }, `Details: ${error.message}`));
      }
      return;
    }
    const firstRun = !data.has_owner;
    $('#signup-link').hidden = !firstRun;
    if (firstRun && !isRecovery) {
      showBanner('info', 'Welcome! No owner account exists yet. Create yours below — it becomes the shop owner automatically.');
      show('signup');
    }
  });

  // Already signed in as the owner? Skip straight to the dashboard.
  if (!isRecovery) {
    sb.auth.getSession().then(async ({ data: { session } }) => {
      if (!session || params.get('reason') === 'notadmin' || params.get('reason') === 'signedout') return;
      const { data: isAdmin } = await becomeOwner();
      if (isAdmin) location.replace(destination());
    });
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      showBanner('info', 'Choose a new password for your account.');
      show('recover');
    }
  });

  // Show / hide password
  for (const btn of document.querySelectorAll('[data-toggle-password]')) {
    const input = document.getElementById(btn.dataset.togglePassword);
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      clear(btn).appendChild(icon(showing ? 'eye' : 'eyeOff', { size: 20 }));
    });
  }

  const fieldError = (input, message) => {
    const err = document.getElementById(`${input.id}-error`);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (err) {
      clear(err);
      if (message) err.append(icon('alert', { size: 14 }), message);
    }
  };

  /* --- Log in --- */
  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email');
    const password = $('#password');
    fieldError(email, '');
    fieldError(password, '');
    let ok = true;
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { fieldError(email, 'Enter a valid email address.'); ok = false; }
    if (!password.value) { fieldError(password, 'Enter your password.'); ok = false; }
    if (!ok) { forms.login.querySelector('[aria-invalid="true"]').focus(); return; }

    const btn = forms.login.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Logging in…');
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) {
      setBusy(btn, false);
      if (/invalid login credentials/i.test(error.message)) fieldError(password, 'Wrong email or password. Try again or reset your password.');
      else if (/email not confirmed/i.test(error.message)) fieldError(email, 'Please confirm your email first (check your inbox), or create the user with “Auto confirm” in Supabase.');
      else showBanner('error', friendlyError(error, 'log in'));
      password.focus();
      return;
    }
    const { data: isAdmin, error: adminErr } = await becomeOwner();
    if (adminErr || !isAdmin) {
      setBusy(btn, false);
      await sb.auth.signOut().catch(() => {});
      showBanner('error', adminErr ? friendlyError(adminErr, 'check your account') : REASONS.notadmin.text);
      return;
    }
    location.replace(destination());
  });

  /* --- Create the owner account (first run) --- */
  $('#signup-link').addEventListener('click', () => { $('#su-email').value = $('#email').value; show('signup'); });
  $('#signup-to-login').addEventListener('click', () => show('login'));

  forms.signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#su-email');
    const pw = $('#su-password');
    const pw2 = $('#su-password-2');
    for (const el of [email, pw, pw2]) fieldError(el, '');
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { fieldError(email, 'Enter a valid email address.'); email.focus(); return; }
    if (pw.value.length < 8) { fieldError(pw, 'Use at least 8 characters.'); pw.focus(); return; }
    if (pw.value !== pw2.value) { fieldError(pw2, 'Passwords don’t match.'); pw2.focus(); return; }

    const btn = forms.signup.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Creating…');
    const { data, error } = await sb.auth.signUp({
      email: email.value.trim(),
      password: pw.value,
      options: { emailRedirectTo: new URL(LOGIN, location.href).href.split('?')[0] },
    });
    if (error) {
      setBusy(btn, false);
      if (/already registered|already exists/i.test(error.message)) {
        $('#email').value = email.value.trim();
        show('login');
        showBanner('info', 'That email already has an account — log in with it below.');
      } else {
        showBanner('error', friendlyError(error, 'create the account'));
      }
      return;
    }
    if (!data.session) {
      // Supabase "Confirm email" is on: the owner must click the email link first.
      setBusy(btn, false);
      $('#email').value = email.value.trim();
      show('login');
      showBanner('success', `Almost done! We emailed a confirmation link to ${email.value.trim()}. Click it — even if the page it opens doesn’t load, your email is confirmed — then come back here and log in. (No email? See README → “Confirmation email”.)`);
      return;
    }
    const { data: isAdmin, error: ownErr } = await becomeOwner();
    if (ownErr || !isAdmin) {
      setBusy(btn, false);
      showBanner('error', ownErr ? friendlyError(ownErr, 'set up the owner account') : REASONS.notadmin.text);
      return;
    }
    location.replace(destination());
  });

  /* --- Forgot password --- */
  $('#forgot-link').addEventListener('click', () => {
    $('#forgot-email').value = $('#email').value;
    show('forgot');
  });
  $('#back-to-login').addEventListener('click', () => show('login'));

  forms.forgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgot-email');
    fieldError(email, '');
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { fieldError(email, 'Enter a valid email address.'); email.focus(); return; }
    const btn = forms.forgot.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Sending…');
    const redirectTo = new URL(LOGIN, location.href).href.split('?')[0];
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
    setBusy(btn, false);
    if (error) { showBanner('error', friendlyError(error, 'send the reset email')); return; }
    showBanner('success', `If ${email.value.trim()} has an account, a reset link is on its way. Check your inbox (and spam).`);
    show('login');
  });

  /* --- Set a new password (after clicking the email link) --- */
  forms.recover.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#new-password');
    const pw2 = $('#new-password-2');
    fieldError(pw, '');
    fieldError(pw2, '');
    if (pw.value.length < 8) { fieldError(pw, 'Use at least 8 characters.'); pw.focus(); return; }
    if (pw.value !== pw2.value) { fieldError(pw2, 'Passwords don’t match.'); pw2.focus(); return; }
    const btn = forms.recover.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Saving…');
    const { error } = await sb.auth.updateUser({ password: pw.value });
    setBusy(btn, false);
    if (error) { showBanner('error', friendlyError(error, 'update your password')); return; }
    history.replaceState(null, '', LOGIN);
    toast('Password updated', { type: 'success' });
    location.replace(destination());
  });
}

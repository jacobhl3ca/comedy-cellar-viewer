// Optional account + cross-device sync. Anonymous use remains entirely local.
(function setupAccountSync(){
  const PREFS_KEY = 'cellar-tonight-prefs';
  const SETTINGS_KEY = 'tonight-nyc-settings';
  const SYNC_META_KEY = 'tonight-nyc-sync-meta';
  const SYNC_BACKUP_KEY = 'tonight-nyc-sync-backup';
  let signedIn = false;
  let pushTimer = null;
  let lastPull = 0;

  const status = document.getElementById('account-status');
  const signedOut = document.getElementById('account-signed-out');
  const signedInBox = document.getElementById('account-signed-in');
  const emailOut = document.getElementById('account-email');
  const signInBtn = document.getElementById('account-apple-signin');
  const googleBtn = document.getElementById('account-google-signin');
  const emailForm = document.getElementById('account-email-form');
  const emailRequestRow = document.getElementById('account-email-request-row');
  const emailCodeRow = document.getElementById('account-email-code-row');
  const emailInput = document.getElementById('account-email-input');
  const emailCode = document.getElementById('account-email-code');
  const emailSendBtn = document.getElementById('account-email-send');
  const emailVerifyBtn = document.getElementById('account-email-verify');
  const emailChangeBtn = document.getElementById('account-email-change');
  const linkActions = document.getElementById('account-link-actions');
  const linkAppleBtn = document.getElementById('account-link-apple');
  const linkGoogleBtn = document.getElementById('account-link-google');
  const linkEmailBtn = document.getElementById('account-link-email');
  const signOutBtn = document.getElementById('account-signout');
  const deleteBtn = document.getElementById('account-delete');
  const accountSection = document.querySelector('.account-section');

  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }

  function localPayload(){
    const rawPrefs = readJson(PREFS_KEY, {});
    return {
      prefs: {
        faves: Array.isArray(rawPrefs.faves) ? rawPrefs.faves : [],
        skips: Array.isArray(rawPrefs.skips) ? rawPrefs.skips : [],
        likes: Array.isArray(rawPrefs.likes) ? rawPrefs.likes : [],
      },
      settings: readJson(SETTINGS_KEY, {}),
    };
  }

  function samePayload(a, b){
    return JSON.stringify(a?.prefs || {}) === JSON.stringify(b?.prefs || {}) &&
      JSON.stringify(a?.settings || {}) === JSON.stringify(b?.settings || {});
  }

  function setStatus(message, error){
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('account-error', Boolean(error));
  }

  function renderAuth(auth){
    signedIn = Boolean(auth?.signedIn);
    const appleAvailable = auth?.providers?.apple !== false && (!isNative() || !!nativeAppleBridge());
    const googleAvailable = auth?.providers?.google === true && (!isNative() || !!nativeGoogleBridge());
    const emailAvailable = auth?.providers?.email === true;
    const linked = Array.isArray(auth?.linkedProviders) && auth.linkedProviders.length
      ? auth.linkedProviders
      : auth?.provider ? [auth.provider] : [];
    if (signInBtn) signInBtn.hidden = !appleAvailable;
    if (googleBtn) googleBtn.hidden = !googleAvailable;
    if (signedOut) signedOut.hidden = signedIn || (!appleAvailable && !googleAvailable && !emailAvailable);
    if (signedInBox) signedInBox.hidden = !signedIn;
    // Signed in, the email form is the *link* flow, not a sign-in prompt: it
    // stays collapsed behind "Link email" so an Apple/Google account never shows
    // an empty "Email address / Email me a code" box under "Signed in as …".
    if (emailForm) emailForm.hidden = !emailAvailable || signedIn;
    if (emailOut) emailOut.textContent = auth?.email || 'your account';
    if (linkAppleBtn) linkAppleBtn.hidden = !signedIn || !appleAvailable || linked.includes('apple');
    if (linkGoogleBtn) linkGoogleBtn.hidden = !signedIn || !googleAvailable || linked.includes('google');
    if (linkEmailBtn) linkEmailBtn.hidden = !signedIn || !emailAvailable || linked.includes('email');
    if (linkActions) {
      linkActions.hidden = linkAppleBtn?.hidden !== false &&
        linkGoogleBtn?.hidden !== false &&
        linkEmailBtn?.hidden !== false;
    }
    if (signedIn) setStatus('Synced automatically.');
    else if (!appleAvailable && !googleAvailable && !emailAvailable) setStatus('Account sync is not configured yet.');
    else setStatus('Sign in to sync your comedians and settings across devices.');
  }

  async function pushNow(keepalive){
    if (!signedIn) return;
    const response = await fetch('/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localPayload()),
      keepalive: Boolean(keepalive),
    });
    if (!response.ok) throw new Error(`sync failed: ${response.status}`);
    const data = await response.json();
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ updatedAt: data.updatedAt || null }));
    setStatus('Synced automatically.');
  }

  function queueSync(){
    if (!signedIn) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushNow(false).catch(() => setStatus('Saved on this device; sync will retry.', true));
    }, 800);
  }
  window.__tonightNycQueueSync = queueSync;

  function flushSync(){
    if (!pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    pushNow(true).catch(() => {});
  }

  async function pullRemote(){
    if (!signedIn) return;
    lastPull = Date.now();
    const response = await fetch('/api/prefs', { credentials: 'include' });
    if (!response.ok) throw new Error(`sync failed: ${response.status}`);
    const { sync } = await response.json();
    if (!sync) {
      await pushNow(false);
      return;
    }
    const remote = { prefs: sync.prefs || {}, settings: sync.settings || {} };
    const local = localPayload();
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ updatedAt: sync.updatedAt || null }));
    if (samePayload(local, remote)) return;
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({ ...local, savedAt: new Date().toISOString() }));
    localStorage.setItem(PREFS_KEY, JSON.stringify(remote.prefs));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(remote.settings));
    window.location.reload();
  }

  function isNative(){
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function nativeAppleBridge(){
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.TonightAppleAuth || null;
  }

  function nativeGoogleBridge(){
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.TonightGoogleAuth || null;
  }

  function base64url(bytes){
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function googleVerifier(){
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64url(new Uint8Array(digest)) };
  }

  async function waitForGoogleCallback(plugin){
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const result = await plugin.consumeCallback?.();
      if (result?.callbackUrl) return result.callbackUrl;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Google sign-in timed out');
  }

  async function signIn(link){
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      window.location.href = `/api/auth/apple/login?returnTo=/${link ? '&link=1' : ''}`;
      return;
    }
    const plugin = nativeAppleBridge();
    if (!plugin) {
      if (accountSection) accountSection.hidden = true;
      return;
    }
    signInBtn.disabled = true;
    try {
      const nonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const result = await plugin.authorize({ nonce });
      const response = await fetch('/api/auth/apple/native', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityToken: result?.identityToken,
          email: result?.email || null,
          nonce,
          link: Boolean(link),
        }),
      });
      if (!response.ok) throw new Error(`native sign-in failed: ${response.status}`);
      window.location.reload();
    } catch (error) {
      if (!/cancel|1001/i.test(String(error?.message || error))) {
        setStatus('Apple sign-in failed. Please try again.', true);
      }
      signInBtn.disabled = false;
    }
  }

  async function signInGoogle(link){
    const plugin = nativeGoogleBridge();
    if (!isNative()) {
      window.location.href = `/api/auth/google/login?returnTo=/${link ? '&link=1' : ''}`;
      return;
    }
    if (!plugin) return;
    googleBtn && (googleBtn.disabled = true);
    linkGoogleBtn && (linkGoogleBtn.disabled = true);
    try {
      const { verifier, challenge } = await googleVerifier();
      const start = new URL('/api/auth/google/login', window.location.origin);
      start.searchParams.set('returnTo', '/');
      start.searchParams.set('nativeChallenge', challenge);
      if (link) {
        const proofResponse = await fetch('/api/auth/google/native', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'link_token' }),
        });
        if (!proofResponse.ok) throw new Error('could not authorize account linking');
        const proof = await proofResponse.json();
        if (!proof.linkToken) throw new Error('server returned no link token');
        start.searchParams.set('nativeLinkToken', proof.linkToken);
      }
      const launched = await plugin.authorize({ url: start.toString(), callbackScheme: 'tonight-auth' });
      const callbackUrl = launched.callbackUrl || await waitForGoogleCallback(plugin);
      const callback = new URL(callbackUrl);
      const code = callback.searchParams.get('code');
      if (!code) throw new Error('Google returned no handoff code');
      const response = await fetch('/api/auth/google/native', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, verifier }),
      });
      if (!response.ok) throw new Error(`native sign-in failed: ${response.status}`);
      window.location.reload();
    } catch (error) {
      if (!/cancel/i.test(String(error?.message || error))) setStatus('Google sign-in failed. Please try again.', true);
      googleBtn && (googleBtn.disabled = false);
      linkGoogleBtn && (linkGoogleBtn.disabled = false);
    }
  }

  async function emailCodeStep(event){
    event.preventDefault();
    const verifying = emailCodeRow?.hidden === false;
    const button = verifying ? emailVerifyBtn : emailSendBtn;
    button && (button.disabled = true);
    try {
      const response = await fetch(verifying ? '/api/auth/email/verify' : '/api/auth/email/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput?.value || '', code: verifying ? emailCode?.value || '' : undefined }),
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Too many tries. Wait a little and try again.');
        if (verifying && response.status === 401) throw new Error('That code is wrong or expired.');
        throw new Error(verifying ? 'Could not verify that code.' : 'Could not send a code.');
      }
      if (verifying) {
        window.location.reload();
        return;
      }
      if (emailRequestRow) emailRequestRow.hidden = true;
      if (emailCodeRow) emailCodeRow.hidden = false;
      emailInput && (emailInput.readOnly = true);
      emailCode?.focus();
      setStatus('Check your email for a six-digit code.');
    } catch (caught) {
      setStatus(caught?.message || 'Email sign-in failed. Please try again.', true);
    } finally {
      button && (button.disabled = false);
    }
  }

  async function signOut(){
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (response.ok) window.location.reload();
    else setStatus('Could not sign out. Please try again.', true);
  }

  async function deleteAccount(){
    if (!confirm('Permanently delete your account and synced data? Your favorites on this device will stay here.')) return;
    const typed = prompt('Type DELETE to confirm. This cannot be undone.');
    if (typed?.trim().toUpperCase() !== 'DELETE') return;
    const response = await fetch('/api/account', { method: 'DELETE', credentials: 'include' });
    if (response.ok) window.location.reload();
    else setStatus('Could not delete the account. Please try again.', true);
  }

  signInBtn?.addEventListener('click', () => signIn(false));
  googleBtn?.addEventListener('click', () => signInGoogle(false));
  emailForm?.addEventListener('submit', emailCodeStep);
  emailChangeBtn?.addEventListener('click', () => {
    if (emailRequestRow) emailRequestRow.hidden = false;
    if (emailCodeRow) emailCodeRow.hidden = true;
    if (emailInput) { emailInput.readOnly = false; emailInput.focus(); }
    if (emailCode) emailCode.value = '';
  });
  linkAppleBtn?.addEventListener('click', () => signIn(true));
  linkGoogleBtn?.addEventListener('click', () => signInGoogle(true));
  linkEmailBtn?.addEventListener('click', () => {
    // /api/auth/email/verify links onto the live session when one exists, so the
    // same two-step form doubles as "add email to this account".
    if (emailForm) emailForm.hidden = false;
    linkEmailBtn.hidden = true;
    if (emailRequestRow) emailRequestRow.hidden = false;
    if (emailCodeRow) emailCodeRow.hidden = true;
    if (emailInput) { emailInput.readOnly = false; emailInput.focus(); }
    setStatus('Enter an email to add it as another way into this account.');
  });
  signOutBtn?.addEventListener('click', signOut);
  deleteBtn?.addEventListener('click', deleteAccount);
  window.addEventListener('pagehide', flushSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSync();
    else if (signedIn && Date.now() - lastPull > 30000) pullRemote().catch(() => {});
  });

  (async () => {
    // The released native shell predates the Apple-auth bridge but loads the
    // current web bundle. Keep account controls out of that version until an
    // App Store build containing the bridge is actually available.
    const error = new URLSearchParams(window.location.search).get('auth_error');
    if (error) setStatus('Apple sign-in did not finish. Please try again.', true);
    try {
      const response = await fetch('/api/me', { credentials: 'include' });
      if (!response.ok) throw new Error('auth unavailable');
      const auth = await response.json();
      renderAuth(auth);
      if (auth.signedIn) await pullRemote();
    } catch {
      renderAuth({ signedIn: false, providers: { apple: false, google: false, email: false } });
    }
  })();
})();

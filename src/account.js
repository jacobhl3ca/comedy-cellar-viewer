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
  const signOutBtn = document.getElementById('account-signout');
  const deleteBtn = document.getElementById('account-delete');

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
    if (signedOut) signedOut.hidden = signedIn || auth?.providers?.apple === false;
    if (signedInBox) signedInBox.hidden = !signedIn;
    if (emailOut) emailOut.textContent = auth?.email || 'your Apple account';
    if (signedIn) setStatus('Synced automatically.');
    else if (auth?.providers?.apple === false) setStatus('Account sync is not configured yet.');
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

  function nativeBridge(){
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.TonightAppleAuth || null;
  }

  async function signIn(){
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      window.location.href = '/api/auth/apple/login?returnTo=/';
      return;
    }
    const plugin = nativeBridge();
    if (!plugin) {
      alert('Update Tonight NYC from the App Store to use Sign in with Apple.');
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

  signInBtn?.addEventListener('click', signIn);
  signOutBtn?.addEventListener('click', signOut);
  deleteBtn?.addEventListener('click', deleteAccount);
  window.addEventListener('pagehide', flushSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSync();
    else if (signedIn && Date.now() - lastPull > 30000) pullRemote().catch(() => {});
  });

  (async () => {
    const error = new URLSearchParams(window.location.search).get('auth_error');
    if (error) setStatus('Apple sign-in did not finish. Please try again.', true);
    try {
      const response = await fetch('/api/me', { credentials: 'include' });
      if (!response.ok) throw new Error('auth unavailable');
      const auth = await response.json();
      renderAuth(auth);
      if (auth.signedIn) await pullRemote();
    } catch {
      renderAuth({ signedIn: false, providers: { apple: false } });
    }
  })();
})();

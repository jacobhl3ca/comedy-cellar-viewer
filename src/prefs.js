// ---- Preferences (localStorage + URL hash sync) ----
const STORAGE_KEY = 'cellar-tonight-prefs';
// bookmarkToastShown removed — only used in commented-out showBookmarkToast()

// Synchronous version — reads from localStorage only (used by isFav/isSkip/isLike/cycleComedian)
function loadPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { faves: stored.faves || [], skips: stored.skips || [], likes: stored.likes || [] };
  } catch { return { faves: [], skips: [], likes: [] }; }
}

// Async version — checks URL hash first (for shared links), called once at startup
async function loadPrefsFromHash() {
  try {
    const hashPrefs = await readHashPrefs();
    if (hashPrefs) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hashPrefs));
      history.replaceState(null, '', window.location.pathname);
      return hashPrefs;
    }
    return loadPrefs();
  } catch { return loadPrefs(); }
}

function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  updateShareBtn();
}

function updateShareBtn() {
  const p = loadPrefs();
  const hasPrefs = p.faves.length > 0 || p.skips.length > 0 || p.likes.length > 0;
  // Settings can also produce a non-default share link.
  const hasSettings = typeof window.__tonightNycHasNonDefault === 'function' && window.__tonightNycHasNonDefault();
  const visible = hasPrefs || hasSettings;
  const headerBtn = document.getElementById('header-share');
  if (headerBtn) headerBtn.classList.toggle('visible', visible);
  const modalBtn = document.getElementById('share-link');
  if (modalBtn) modalBtn.style.display = hasPrefs ? '' : 'none';
}

// Compressed prefs: deflate + base64url of "fave1|fave2\nskip1|skip2\nlike1|like2"
async function compressPrefs(prefs) {
  const raw = [
    (prefs.faves || []).join('|'),
    (prefs.skips || []).join('|'),
    (prefs.likes || []).join('|')
  ].join('\n');
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let b64 = btoa(String.fromCharCode(...compressed));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressPrefs(compressed) {
  let b64 = compressed.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const decoded = await new Response(stream).text();
  const [faveLine, skipLine, likeLine] = decoded.split('\n');
  return {
    faves: faveLine ? faveLine.split('|') : [],
    skips: skipLine ? skipLine.split('|') : [],
    likes: likeLine ? likeLine.split('|') : []
  };
}

// Encode prefs into URL hash (compressed, with fallback to legacy format)
async function updateHashFromPrefs(prefs) {
  try {
    if (prefs.faves.length === 0 && prefs.skips.length === 0 && prefs.likes.length === 0) {
      history.replaceState(null, '', window.location.pathname);
      return;
    }
    if (typeof CompressionStream !== 'undefined') {
      const compressed = await compressPrefs(prefs);
      history.replaceState(null, '', '#p=' + compressed);
    } else {
      // Fallback: legacy uncompressed format (Safari < 16.4)
      const params = new URLSearchParams();
      if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
      if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
      if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
      history.replaceState(null, '', '#' + params.toString());
    }
  } catch (e) {
    console.error('updateHashFromPrefs error:', e);
  }
}

// Read prefs from URL hash — supports both compressed (#p=...) and legacy (#f=...&s=...)
async function readHashPrefs() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    // New compressed format
    if (params.get('p') && typeof DecompressionStream !== 'undefined') {
      try {
        return await decompressPrefs(params.get('p'));
      } catch (e) {
        console.error('Decompress failed:', e);
        return null;
      }
    }
    // Legacy format (backward compat)
    const faves = params.get('f') ? params.get('f').split('|') : [];
    const skips = params.get('s') ? params.get('s').split('|') : [];
    const likes = params.get('l') ? params.get('l').split('|') : [];
    if (faves.length === 0 && skips.length === 0 && likes.length === 0) return null;
    return { faves, skips, likes };
  } catch { return null; }
}

// Save-URL toast — commented out for now (revisit later)
// function showBookmarkToast() {
//   if (bookmarkToastShown) return;
//   const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
//   if ((prefs.faves?.length || 0) + (prefs.skips?.length || 0) + (prefs.likes?.length || 0) < 1) return;
//   bookmarkToastShown = true;
//
//   const toast = document.createElement('div');
//   toast.className = 'bookmark-toast';
//   toast.innerHTML = `
//     <span>Your picks are saved in the URL — copy it to keep them!</span>
//     <button class="toast-copy-btn" onclick="copyPrefsUrl(this)">Copy URL</button>
//     <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
//   `;
//   document.body.appendChild(toast);
//   setTimeout(() => toast.classList.add('visible'), 50);
// }
function showBookmarkToast() { /* disabled */ }

async function copyPrefsUrl(btn) {
  const prefs = loadPrefs();
  const compressed = await compressPrefs(prefs);
  const url = window.location.origin + window.location.pathname + '#p=' + compressed;
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy URL'; }, 2000);
  });
}

function isFav(name) { return loadPrefs().faves.includes(name); }
function isSkip(name) { return loadPrefs().skips.includes(name); }
function isLike(name) { return loadPrefs().likes.includes(name); }

function cycleComedian(name) {
  const prefs = loadPrefs();
  const inFavs = prefs.faves.includes(name);
  const inSkips = prefs.skips.includes(name);
  const inLikes = prefs.likes.includes(name);

  // Cycle: Neutral → Fave → Skip → Neutral
  prefs.faves = prefs.faves.filter(n => n !== name);
  prefs.skips = prefs.skips.filter(n => n !== name);
  prefs.likes = prefs.likes.filter(n => n !== name);

  if (!inFavs && !inSkips && !inLikes) {
    // Neutral → Fave
    prefs.faves.push(name);
    if (window.va) window.va('event', { name: 'fave', data: { comedian: name } });
    if (typeof Native !== 'undefined') Native.impact('Medium');
  } else if (inFavs) {
    // Fave → Skip
    prefs.skips.push(name);
    if (window.va) window.va('event', { name: 'skip', data: { comedian: name } });
    if (typeof Native !== 'undefined') Native.impact('Light');
  } else {
    if (typeof Native !== 'undefined') Native.impact('Light');
  }

  savePrefs(prefs);
  updateSettingsBtnState();
  if (typeof updateResetBtn === 'function') updateResetBtn();
  if (typeof window !== 'undefined' && typeof window._rescheduleReminders === 'function') {
    window._rescheduleReminders();
  }
}

function updateSettingsBtnState() {
  const btn = document.getElementById('open-settings');
  if (!btn) return;
  const prefs = loadPrefs();
  const has = prefs.faves.length > 0 || prefs.skips.length > 0 || prefs.likes.length > 0;
  btn.classList.toggle('has-comedians', has);
  if (has) btn.classList.remove('jingle-intro');
}

// ---- Comedian Database (loaded from /data/comedians.json) ----
let comedianDB = [];

let localPhotoMap = {}; // filename -> extension

function decodeHtmlEntities(str) {
  return str
    .replace(/&#8217;/g, '\u2019').replace(/&#8216;/g, '\u2018')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '');
}

function localPhotoPath(name) {
  const decoded = decodeHtmlEntities(name);
  const filename = decoded.replace(/['''\u2018\u2019]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  const ext = localPhotoMap[filename];
  return ext ? `/photos/${filename}${ext}` : '';
}

async function loadComedianDB() {
  try {
    // Load photo manifest first
    try {
      const mResp = await fetchWithTimeout('/data/photo-manifest.json', {}, 10000);
      localPhotoMap = await mResp.json();
    } catch {}

    const resp = await fetchWithTimeout('/data/comedians.json', {}, 10000);
    comedianDB = await resp.json();
    comedianDB.forEach(c => {
      // DB photos stay in comedianDB — accessed via getPhotoForVenue()
      // Populate legacy map as fallback for non-venue contexts (e.g. My Comedians modal)
      const local = localPhotoPath(c.name);
      if (local && !comedianPhotos[c.name]) comedianPhotos[c.name] = local;
      else if (c.photo_nycc && !comedianPhotos[c.name]) comedianPhotos[c.name] = c.photo_nycc;
      else if (c.photo_stand && !comedianPhotos[c.name]) comedianPhotos[c.name] = c.photo_stand;
    });
  } catch (e) {
    console.error('Failed to load comedian DB:', e);
  }
}

// Fetch Wikipedia bios for comedians missing bios (runs after init, last resort only)
async function enrichBiosFromWikipedia() {
  // Collect names that have no bio from any venue source
  const needBio = [...allComediansSeen].filter(n => {
    if (comedianTaglines[n]) return false; // has Cellar tagline
    const db = comedianDB.find(c => c.name === n);
    if (db?.bio && !isGenericBio(db.bio)) return false; // has NYCC bio
    if (db?.bio_stand && !isGenericBio(db.bio_stand)) return false; // has Stand bio
    return true;
  });
  if (needBio.length === 0) return;

  // Batch in groups of 20
  for (let i = 0; i < Math.min(needBio.length, 60); i += 20) {
    const batch = needBio.slice(i, i + 20);
    try {
      const resp = await fetch('/api/wiki-bio?names=' + encodeURIComponent(batch.join(',')));
      const data = await resp.json();
      if (data.results) {
        Object.entries(data.results).forEach(([name, info]) => {
          // Store in separate wiki map (last resort only)
          if (!comedianWikiBios[name] && info.bio && !isGenericBio(info.bio)) comedianWikiBios[name] = info.bio;
          if (!comedianPhotos[name] && info.image) comedianPhotos[name] = info.image;
        });
      }
    } catch (e) {
      console.error('Wiki bio fetch failed:', e);
    }
  }
}

// ---- Alerts (localStorage + backend sync) ----
const ALERTS_KEY = 'cellar-tonight-alerts';

function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(ALERTS_KEY)) || { email: '', comedians: [] }; }
  catch { return { email: '', comedians: [] }; }
}

function saveAlerts(alerts) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  // Sync to backend if email is set
  if (alerts.email) {
    fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: alerts.email, comedians: alerts.comedians }),
    }).catch(() => {});
  }
}

function isAlerted(name) { return loadAlerts().comedians.includes(name); }

function toggleAlert(name) {
  const alerts = loadAlerts();
  if (alerts.comedians.includes(name)) {
    alerts.comedians = alerts.comedians.filter(n => n !== name);
  } else {
    alerts.comedians.push(name);
  }
  saveAlerts(alerts);
}

function setAlertEmail(email) {
  const alerts = loadAlerts();
  alerts.email = email;
  saveAlerts(alerts);
}

function getAlertEmail() {
  return loadAlerts().email || '';
}

function removeAlert(name) {
  const alerts = loadAlerts();
  alerts.comedians = alerts.comedians.filter(n => n !== name);
  saveAlerts(alerts);
  const search = document.getElementById('comedian-search')?.value || '';
  renderModal(search);
}

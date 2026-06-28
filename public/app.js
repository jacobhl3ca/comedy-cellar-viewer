// ---- Jazz mode ----
// When mode-select is set to 'jazz' the comedy data path is skipped; this module
// owns rendering for the jazz feed. Reuses the existing #venue-source-tabs,
// #day-tabs, and #shows-container DOM plus the .big-show-card CSS that Tonight
// NYC already ships.

const JAZZ_MODE_KEY = 'tonightnyc-mode';

let JAZZ_DATA = { shows: [], today: '', generated_at: '' };
let JAZZ_PHOTOS = {};
let jazzActiveVenue = 'all';
let jazzActiveDate = 'all';

const JAZZ_VENUE_TABS = [
  { key: 'all',                    label: 'All Venues' },
  { key: 'Blue Note NYC',          label: 'Blue Note' },
  { key: 'Village Vanguard',       label: 'Vanguard' },
  { key: 'Smoke Jazz',             label: 'Smoke' },
  { key: 'Birdland',               label: 'Birdland' },
  { key: 'Jazz at Lincoln Center', label: 'JALC' },
  { key: 'Smalls',                 label: 'Smalls/Mezzrow' },
  { key: 'Other',                  label: 'Other' },
];

const JAZZ_SMALLS_LIKE = new Set(['Smalls', 'Mezzrow', 'Jazzcultural']);
const JAZZ_BARE_CITY_RX = /^[A-Z][a-zA-Z]+(?:[\s.-]+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2}$/;
const JAZZ_MIC_ICON = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

function jazzEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function jazzVenueMatches(show) {
  if (jazzActiveVenue === 'all') return true;
  if (jazzActiveVenue === 'Smalls') return JAZZ_SMALLS_LIKE.has(show.venue_label);
  return show.venue_label === jazzActiveVenue;
}

function jazzFilteredShows() {
  return JAZZ_DATA.shows.filter(s => {
    if (!jazzVenueMatches(s)) return false;
    if (jazzActiveDate !== 'all' && s.date !== jazzActiveDate) return false;
    return true;
  });
}

function jazzDayTabLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(JAZZ_DATA.today + 'T00:00:00');
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (iso === JAZZ_DATA.today) return 'Today';
  if (d.getTime() === tomorrow.getTime()) return 'Tmrw';
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
}

function jazzRenderVenueTabs() {
  const container = document.getElementById('venue-source-tabs');
  if (!container) return;
  container.innerHTML = JAZZ_VENUE_TABS.map(t =>
    `<button class="venue-source-tab ${t.key === jazzActiveVenue ? 'active' : ''}" data-venue="${jazzEscape(t.key)}">${jazzEscape(t.label)}</button>`
  ).join('');
  container.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      jazzActiveVenue = btn.dataset.venue;
      jazzRenderVenueTabs();
      jazzRenderDayTabs();
      jazzRenderShows();
    });
  });
}

function jazzRenderDayTabs() {
  const tabs = document.getElementById('day-tabs');
  if (!tabs) return;
  const dates = [...new Set(JAZZ_DATA.shows
    .filter(s => jazzActiveVenue === 'all' || jazzVenueMatches(s))
    .map(s => s.date))]
    .sort();
  const buttons = [`<button class="day-tab ${jazzActiveDate === 'all' ? 'active' : ''}" data-date="all">All</button>`]
    .concat(dates.slice(0, 21).map(d =>
      `<button class="day-tab ${jazzActiveDate === d ? 'active' : ''}" data-date="${d}">${jazzEscape(jazzDayTabLabel(d))}</button>`
    ));
  tabs.innerHTML = buttons.join('');
  tabs.querySelectorAll('.day-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      jazzActiveDate = jazzActiveDate === btn.dataset.date ? 'all' : btn.dataset.date;
      jazzRenderDayTabs();
      jazzRenderShows();
    });
  });
}

function jazzGroupShows(shows) {
  const groups = new Map();
  for (const s of shows) {
    const artists = Array.isArray(s.artists) ? s.artists : [];
    const title = (s.title || artists[0] || '').trim();
    const key = `${s.venue_label}|${title.toLowerCase()}|${[...artists].sort().join(',').toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        title, artists,
        venue_label: s.venue_label,
        city: s.city,
        ticket_url: s.ticket_url,
        dates: [],
      });
    }
    groups.get(key).dates.push(s.date);
  }
  for (const g of groups.values()) {
    g.dates = [...new Set(g.dates)].sort();
    g.firstDate = g.dates[0];
  }
  return [...groups.values()].sort((a, b) =>
    a.firstDate.localeCompare(b.firstDate) ||
    a.venue_label.localeCompare(b.venue_label)
  );
}

function jazzPickPhoto(g) {
  for (const a of g.artists) {
    if (JAZZ_PHOTOS[a]) return JAZZ_PHOTOS[a];
  }
  return '';
}

function jazzDateBoxHTML(iso, ticketUrl) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(JAZZ_DATA.today + 'T00:00:00');
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const isToday = iso === JAZZ_DATA.today;
  const isTomorrow = d.getTime() === tomorrow.getTime();
  const dayLabel = isToday ? 'Tonight' : isTomorrow ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' });
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const inner = `<span class="bdb-day">${jazzEscape(dayLabel)} ${jazzEscape(dateLabel)}</span>`;
  const todayClass = isToday ? ' is-today' : '';
  return ticketUrl
    ? `<div class="bdb-wrap"><a href="${jazzEscape(ticketUrl)}" target="_blank" rel="noopener" class="big-date-box${todayClass}">${inner}</a></div>`
    : `<div class="bdb-wrap"><span class="big-date-box${todayClass}">${inner}</span></div>`;
}

function jazzBigShowCardHTML(g) {
  const photoUrl = jazzPickPhoto(g);
  const photoHtml = photoUrl
    ? `<img src="${jazzEscape(photoUrl)}" alt="" class="big-show-photo" loading="lazy" onerror="this.style.display='none'">`
    : `<span class="big-show-photo big-show-photo-placeholder">${JAZZ_MIC_ICON}</span>`;

  const venue = g.venue_label || 'Other';
  const isBareCity = g.city && JAZZ_BARE_CITY_RX.test(g.city);
  const isKnownVenue = venue !== 'Other';
  const showCity = g.city && g.city !== venue && !(isBareCity && isKnownVenue);
  const venueLine = showCity
    ? `<div class="big-show-venue">${jazzEscape(venue)} · ${jazzEscape(g.city)}</div>`
    : `<div class="big-show-venue">${jazzEscape(venue)}</div>`;

  const dateBoxes = g.dates.map(d => jazzDateBoxHTML(d, g.ticket_url)).join('');

  const titleClean = (g.title || '').replace(/<[^>]+>/g, '');
  const showSubtitle = g.artists.length > 1 && titleClean.toLowerCase() !== g.artists.join(' · ').toLowerCase();
  const subtitle = showSubtitle
    ? `<div class="big-show-subtitle">${jazzEscape(g.artists.join(' · '))}</div>`
    : '';

  return `
    <div class="big-show-card">
      <div class="big-show-info">
        ${photoHtml}
        <div class="big-show-details">
          <div class="big-show-title" title="${jazzEscape(titleClean)}">${jazzEscape(titleClean)}</div>
          ${subtitle}
          ${venueLine}
          <div class="big-date-boxes">${dateBoxes}</div>
        </div>
      </div>
    </div>
  `;
}

function jazzRenderShows() {
  const container = document.getElementById('shows-container');
  if (!container) return;
  const shows = jazzFilteredShows();
  if (!shows.length) {
    container.innerHTML = '<div class="loading">No jazz shows match the current filter.</div>';
    return;
  }
  const groups = jazzGroupShows(shows);
  const cards = groups.map(jazzBigShowCardHTML).join('');
  container.innerHTML = `<div class="big-shows-section">${cards}</div>`;
}

function jazzResetHome() {
  jazzActiveVenue = 'all';
  jazzActiveDate = 'all';
  jazzRenderVenueTabs();
  jazzRenderDayTabs();
  jazzRenderShows();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function initJazzMode() {
  document.body.classList.add('mode-jazz');
  document.body.classList.add('picture-mode');

  // Theme — same wiring as comedy mode.
  if (typeof initTheme === 'function') {
    try { initTheme(); } catch {}
  }

  const cacheBust = 'v=' + Date.now();
  try {
    const [showsR, photosR] = await Promise.all([
      fetch('data/jazz_shows.json?' + cacheBust),
      fetch('data/jazz_photo_manifest.json?' + cacheBust).catch(() => null),
    ]);
    JAZZ_DATA = await showsR.json();
    if (photosR && photosR.ok) {
      try { JAZZ_PHOTOS = await photosR.json(); } catch { JAZZ_PHOTOS = {}; }
    }
  } catch (e) {
    document.getElementById('shows-container').innerHTML =
      '<div class="loading">Failed to load jazz data. Run <code>npm run build</code> first.</div>';
    document.getElementById('loading')?.style && (document.getElementById('loading').style.display = 'none');
    document.getElementById('schedule-filter-area')?.classList.add('ready');
    return;
  }

  document.getElementById('loading')?.style && (document.getElementById('loading').style.display = 'none');
  jazzRenderVenueTabs();
  jazzRenderDayTabs();
  jazzRenderShows();
  document.getElementById('schedule-filter-area')?.classList.add('ready');
}

function setupModeSelect() {
  const sel = document.getElementById('mode-select');
  if (!sel) return;
  const current = localStorage.getItem(JAZZ_MODE_KEY) === 'jazz' ? 'jazz' : 'comedy';
  sel.value = current;
  sel.addEventListener('change', () => {
    localStorage.setItem(JAZZ_MODE_KEY, sel.value);
    location.reload();
  });
}

function getMode() {
  // Jazz mode disabled in UI for now — dropdown removed pending rework. Restore by returning the localStorage check.
  return 'comedy';
}

// Expose to global scope — prevents terser from DCE'ing through the typeof guards in init.
window.initJazzMode = initJazzMode;
window.setupModeSelect = setupModeSelect;
window.getMode = getMode;
window.jazzResetHome = jazzResetHome;
// ---- Native bridge (Capacitor on iOS, no-op on web) ----
const Native = (function() {
  function cap() { return window.Capacitor; }
  function isNative() { return !!(cap() && cap().isNativePlatform && cap().isNativePlatform()); }
  function plugin(name) { return cap()?.Plugins?.[name]; }

  async function impact(style) {
    if (!isNative()) return;
    const Haptics = plugin('Haptics');
    if (!Haptics) return;
    try { await Haptics.impact({ style: style || 'Medium' }); } catch {}
  }

  async function selection() {
    if (!isNative()) return;
    const Haptics = plugin('Haptics');
    if (!Haptics) return;
    try { await Haptics.selectionStart(); await Haptics.selectionChanged(); await Haptics.selectionEnd(); } catch {}
  }

  async function share(title, url) {
    if (isNative()) {
      const Share = plugin('Share');
      if (Share) {
        try { await Share.share({ title, url, dialogTitle: title }); return 'native'; } catch { return 'cancelled'; }
      }
    }
    if (navigator.share) {
      try { await navigator.share({ title, url }); return 'webshare'; } catch { return 'cancelled'; }
    }
    try { await navigator.clipboard.writeText(url); return 'clipboard'; } catch { return 'failed'; }
  }

  let _notifPermissionAsked = false;
  async function ensureNotifPermission() {
    if (!isNative()) return false;
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    try {
      const current = await LN.checkPermissions();
      if (current.display === 'granted') return true;
      if (_notifPermissionAsked) return false;
      _notifPermissionAsked = true;
      const req = await LN.requestPermissions();
      return req.display === 'granted';
    } catch { return false; }
  }

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 2147483647;
  }

  // Reschedule all future reminders based on current favorites.
  // items: [{ dateStr, time, title, comedians, venue }]
  async function scheduleReminders(items) {
    if (!isNative()) return { scheduled: 0 };
    const LN = plugin('LocalNotifications');
    if (!LN) return { scheduled: 0 };
    const granted = await ensureNotifPermission();
    if (!granted) return { scheduled: 0 };

    const prefs = (typeof loadPrefs === 'function') ? loadPrefs() : { faves: [] };
    const faveSet = new Set(prefs.faves || []);
    const now = Date.now();
    const toSchedule = [];
    for (const it of items) {
      if (!it || !it.dateStr || !it.time) continue;
      const matching = (it.comedians || []).filter(n => faveSet.has(n));
      if (matching.length === 0) continue;
      const when = parseShowDate(it.dateStr, it.time);
      if (!when) continue;
      const notifyAt = when.getTime() - 60 * 60 * 1000; // 1hr before
      if (notifyAt <= now + 60 * 1000) continue; // skip near-past
      const id = hashId(`${it.dateStr}|${it.time}|${it.title || ''}|${matching.join(',')}`);
      const who = matching.length === 1 ? matching[0] : `${matching[0]} +${matching.length - 1}`;
      toSchedule.push({
        id,
        title: `${who} on at ${it.time}`,
        body: `${it.venue || 'Show'} starts in 1 hr. Tap to open Tonight NYC.`,
        schedule: { at: new Date(notifyAt) },
      });
    }

    try {
      const pending = await LN.getPending();
      if (pending?.notifications?.length) {
        await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      }
    } catch {}
    if (toSchedule.length === 0) return { scheduled: 0 };
    try {
      await LN.schedule({ notifications: toSchedule });
      return { scheduled: toSchedule.length };
    } catch { return { scheduled: 0 }; }
  }

  function parseShowDate(dateStr, timeStr) {
    // dateStr: 'YYYY-MM-DD', timeStr: e.g. '7:30 PM' or '19:30'
    if (!dateStr) return null;
    const m24 = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
    const m12 = /^(\d{1,2}):(\d{2})\s*([APap][Mm])$/.exec(timeStr || '');
    let hh = 0, mm = 0;
    if (m24) { hh = parseInt(m24[1], 10); mm = parseInt(m24[2], 10); }
    else if (m12) {
      hh = parseInt(m12[1], 10) % 12;
      mm = parseInt(m12[2], 10);
      if (m12[3].toUpperCase() === 'PM') hh += 12;
    } else return null;
    const [Y, M, D] = dateStr.split('-').map(n => parseInt(n, 10));
    if (!Y || !M || !D) return null;
    return new Date(Y, M - 1, D, hh, mm, 0, 0);
  }

  return { isNative, impact, selection, share, scheduleReminders, ensureNotifPermission };
})();
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

// ---- Inline SVG icons (replaces emoji that render as ? on iOS) ----
const ICON = {
  bell: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  bellOff: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  search: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  starFilled: '<svg class="ico ico-star" viewBox="0 0 24 24" fill="#FCC419" stroke="#FCC419" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  starOutline: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  x: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  minus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  thumbsUp: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><line x1="7" y1="22" x2="7" y2="11"/></svg>',
  mic: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  warning: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  smartphonePlus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
};
// Expose so inline onerror handlers can reach the mic SVG to swap in a placeholder
window.ICON = ICON;
window.swapPhotoPlaceholder = function(img) {
  const span = document.createElement('span');
  span.className = 'comedian-photo comedian-photo-placeholder';
  span.innerHTML = ICON.mic;
  img.replaceWith(span);
};

// ---- NYC Comedy Regulars ----
// REMOVED session 8 — newcomer/regular logic needs rethinking. Will re-add later.

// ---- Cellar show posters (from comedycellar.com/#showtimes) ----
const CELLAR_POSTERS = {
  'CQ Room': 'https://www.comedycellar.com/wp-content/uploads/2024/12/ComedyCellar_CQROOM_Mondays-1.jpg',
  'Colin Quinn': 'https://www.comedycellar.com/wp-content/uploads/2024/12/ComedyCellar_CQROOM_Mondays-1.jpg',
  'New Joke Night': 'https://www.comedycellar.com/wp-content/uploads/2023/09/Mondays_NewJokeNight_600px.jpg',
  'Bobby Kelly': 'https://www.comedycellar.com/wp-content/uploads/2023/10/Tuesdays_Bobby_600px3.jpg',
  'Robert Kelly': 'https://www.comedycellar.com/wp-content/uploads/2023/10/Tuesdays_Bobby_600px3.jpg',
  'Hot Soup': 'https://www.comedycellar.com/wp-content/uploads/2023/09/Tuesdays_HotSoup_600px.jpg',
  'Jim Norton': 'https://www.comedycellar.com/wp-content/uploads/2023/09/Wednesdays_Norton_600px.jpg',
  'Sunday Brunch': 'https://www.comedycellar.com/wp-content/uploads/2025/05/ComedyCellar_SundayBrunch_2025.jpg',
  'Chris Redd': 'https://www.comedycellar.com/wp-content/uploads/2026/01/FEB_2026_CHRISREDD_RES_600px.jpg',
};

function getCellarPoster(venueName) {
  for (const [key, url] of Object.entries(CELLAR_POSTERS)) {
    if (venueName.toLowerCase().includes(key.toLowerCase())) return url;
  }
  return '';
}

// ---- API (static prebaked data first, live API fallback) ----
const API_URL = '/api/lineup';
const API_BATCH_URL = '/api/lineup-batch';
const STATIC_CELLAR = '/data/cellar-cache.json';
const STATIC_STAND = '/data/stand-cache.json';
const STATIC_GOTHAM = '/data/gotham-cache.json';
const STATIC_NYCC = '/data/nycc-cache.json';
const STATIC_BIG_SHOWS = '/data/big-shows-cache.json';
const STATIC_AVAILABILITY = '/data/availability-cache.json';

// Availability data — keyed by date, each entry has shows with soldout/seatsLeft
let availabilityData = {};

function getDateRange() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDateParam(d) { return d.toISOString().split('T')[0]; }
function getDayName(d) { return d.toLocaleDateString('en-US', { weekday: 'short' }); }
function getDateLabel(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
// Schedule-section header. Append the year for non-current-year dates so
// far-future shows (e.g. a Dec 2026 or Apr 2027 big show) don't read as orphan dates.
function getDayHeaderLabel(d) {
  const opts = { weekday: 'long', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

// Venues that sell tickets only through their own site. SeatGeek/Ticketmaster
// index these events but carry no inventory for them, so the aggregator
// "Tickets" link is a dead end — route the button to the venue's events page.
// Extend as more primary-only venues (bookstores etc.) appear in the feed.
const VENUE_TICKET_URLS = [
  { match: 'strand book store', url: 'https://www.strandbooks.com/events.html' },
];
function venueTicketUrl(venue) {
  const v = (venue || '').toLowerCase();
  const hit = VENUE_TICKET_URLS.find(o => v.includes(o.match));
  return hit ? hit.url : null;
}

// Global headshot maps: per-venue + fallback
const comedianPhotos = {};           // legacy fallback (any source)
const comedianPhotosCellar = {};     // from Cellar API
const comedianPhotosStand = {};      // from Stand scraper

// Persistent photo cache — survives across page loads so comedians
// who appeared in past lineups keep their photos even when not scheduled
const PHOTO_CACHE_KEY = 'cellar-tonight-photo-cache';
function loadPhotoCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(PHOTO_CACHE_KEY)) || {};
    Object.entries(cached).forEach(([name, url]) => {
      if (!comedianPhotosCellar[name]) comedianPhotosCellar[name] = url;
      if (!comedianPhotos[name]) comedianPhotos[name] = url;
    });
  } catch {}
}
function savePhotoCache() {
  try { localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(comedianPhotosCellar)); } catch {}
}
loadPhotoCache();

// Auto-resolve missing photos via server-side scrape (NYCC/Stand)
const PHOTO_LOOKUP_CACHE_KEY = 'cellar-tonight-photo-lookup';
let photoLookupCache = {};
try { photoLookupCache = JSON.parse(localStorage.getItem(PHOTO_LOOKUP_CACHE_KEY)) || {}; } catch {}

// Detect bad photo URLs — Instagram icons, placeholder images, etc.
function isBadPhotoUrl(url) {
  if (!url) return false;
  // Instagram icon/logo served as og:image (not a real profile photo)
  if (/instagram\.com\/static\/images/i.test(url)) return true;
  if (/cdninstagram\.com.*\/instagram/i.test(url)) return true;
  // Instagram CDN profile pics that are actually the default/logo (very common false positive)
  // Real IG profile pics have /v/ or /t51/ paths; logos have /rsrc or /static
  if (/instagram\.com/i.test(url) && !/\/v\/|\/t51\.|\/p\//.test(url)) return true;
  // SeatGeek placeholders
  if (/seatgeek\.com/i.test(url) && /placeholder|generic/i.test(url)) return true;
  return false;
}

// Purge bad URLs from localStorage cache on load
let purged = false;
for (const [name, url] of Object.entries(photoLookupCache)) {
  if (isBadPhotoUrl(url)) {
    delete photoLookupCache[name];
    purged = true;
  }
}
if (purged) {
  try { localStorage.setItem(PHOTO_LOOKUP_CACHE_KEY, JSON.stringify(photoLookupCache)); } catch {}
}

const photoLookupInFlight = {};

function autoResolvePhoto(name, imgEl) {
  // Already have a cached result (even if empty — means we tried and found nothing)
  if (name in photoLookupCache) {
    if (photoLookupCache[name] && imgEl) {
      imgEl.src = photoLookupCache[name];
      imgEl.style.display = '';
    }
    return;
  }
  // Already in flight
  if (photoLookupInFlight[name]) {
    photoLookupInFlight[name].push(imgEl);
    return;
  }
  photoLookupInFlight[name] = [imgEl];
  fetchWithTimeout(`/api/photo-lookup?name=${encodeURIComponent(name)}`, {}, 12000)
    .then(r => r.json())
    .then(data => {
      const url = (data.url && !isBadPhotoUrl(data.url)) ? data.url : '';
      photoLookupCache[name] = url;
      try { localStorage.setItem(PHOTO_LOOKUP_CACHE_KEY, JSON.stringify(photoLookupCache)); } catch {}
      if (url) {
        // Also save to global maps so future renders don't need lookup
        if (!comedianPhotos[name]) comedianPhotos[name] = url;
        // Patch all waiting img elements
        (photoLookupInFlight[name] || []).forEach(el => {
          if (el) { el.src = url; el.style.display = ''; }
        });
      }
      delete photoLookupInFlight[name];
    })
    .catch(() => {
      photoLookupCache[name] = '';
      delete photoLookupInFlight[name];
    });
}

// Venue-aware photo lookup: local prebaked first (verified), then external fallbacks
function getPhotoForVenue(name, venueSource) {
  const dbEntry = comedianDB.find(c => c.name === name);
  const local = localPhotoPath(name);
  // 1. Venue-specific photo from that venue's own site (takes priority over generic local)
  if (venueSource === 'stand') {
    if (comedianPhotosStand[name]) return comedianPhotosStand[name];
    if (dbEntry?.photo_stand) return dbEntry.photo_stand;
  }
  if (venueSource === 'cellar' && comedianPhotosCellar[name]) return comedianPhotosCellar[name];
  if (venueSource === 'nycc' && dbEntry?.photo_nycc) return dbEntry.photo_nycc;
  // 2. Local prebaked photo (CDN, generic fallback)
  if (local) return local;
  // 3. Cross-venue external fallbacks
  if (dbEntry?.photo_nycc) return dbEntry.photo_nycc;
  if (comedianPhotosCellar[name]) return comedianPhotosCellar[name];
  if (comedianPhotosStand[name]) return comedianPhotosStand[name];
  if (dbEntry?.photo_stand) return dbEntry.photo_stand;
  // 4. Legacy pool (Wikipedia, SeatGeek, etc.) — reject bad URLs
  const legacy = comedianPhotos[name] || '';
  return isBadPhotoUrl(legacy) ? '' : legacy;
}

function parseShows(html, dateStr) {
  // Split by show blocks — each show starts with <div><div class="set-header">
  const blocks = html.split('<div><div class="set-header">').slice(1);
  const shows = [];

  // Extract name-to-photo and name-to-tagline mappings
  const photoMatches = [...html.matchAll(/<img src="([^"]+)"[^>]*>[\s\S]*?<span class="name">([^<]+)<\/span>/g)];
  let newPhotos = false;
  photoMatches.forEach(m => {
    const name = normalizeName(m[2].trim());
    const imgUrl = m[1].startsWith('http') ? m[1] : 'https://www.comedycellar.com' + m[1];
    if (!comedianPhotosCellar[name]) { comedianPhotosCellar[name] = imgUrl; newPhotos = true; }
    if (!comedianPhotos[name]) comedianPhotos[name] = imgUrl;
  });
  if (newPhotos) savePhotoCache();
  // Taglines: text after </span> inside the <p> that contains the name
  const tagMatches = [...html.matchAll(/<span class="name">([^<]+)<\/span>\s*(.*?)<\/p>/g)];
  tagMatches.forEach(m => {
    const name = normalizeName(m[1].trim());
    let tagline = m[2].trim().replace(/^,\s*/, '').replace(/<[^>]+>/g, '').trim();
    if (tagline && !comedianTaglines[name] && !isGenericBio(tagline)) {
      comedianTaglines[name] = toProperCase(tagline);
    }
  });

  const seen = new Set();
  blocks.forEach(block => {
    const timeMatch = block.match(/<span class="bold">(.*?)<span/);
    const venueMatch = block.match(/<span class="title">(.*?)<\/span>/);
    const linkMatch = block.match(/href="(\/reservations-newyork\/\?showid=(\d+))"/);
    const names = [...block.matchAll(/<span class="name">(.*?)<\/span>/g)].map(m => normalizeName(m[1]));

    const time = timeMatch ? timeMatch[1].trim() : '';
    const venue = venueMatch ? venueMatch[1].trim() : '';
    const reserveUrl = linkMatch
      ? 'https://www.comedycellar.com' + linkMatch[1] + '&date=' + dateStr
      : '';

    if (!time) return;
    const key = linkMatch ? `id:${linkMatch[2]}` : `tv:${time}|${venue}|${names.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    shows.push({ time, venue, comedians: names, reserveUrl });
  });

  return shows;
}

// ---- Name normalization (fix API inconsistencies) ----
const NAME_FIXES = {
  'Will Sylvince': 'Wil Sylvince',
  'Wil Sylvince': 'Wil Sylvince',
  'Luis Gomez': 'Luis J Gomez',
  'Luis J. Gomez': 'Luis J Gomez',
  'Peter Fowler': 'Peter James Fowler',
  'Crystal Marie': 'Crystal Marie Denha',
  'H.Foley': 'H. Foley',
  'Roy Wood Jr': 'Roy Wood Jr.',
  'Eric D\'Alessandro': 'Eric D’Alessandro',
  'Maria Decotis': 'Maria DeCotis',
  'Matteo lane': 'Matteo Lane',
  'Onika Mclean': 'Onika McLean',
  'Tom Mcguire': 'Tom McGuire',
  'Anthony Devito': 'Anthony DeVito',
};
function normalizeName(name) {
  // Sanitize HTML entities to prevent XSS from API data
  const clean = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return NAME_FIXES[clean] || clean;
}

// ---- Time helpers ----
function to24h(timeStr) {
  // Convert "9:35 pm" -> "21:35", "6:45 pm" -> "18:45"
  const m = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${h.toString().padStart(2, '0')}:${min}`;
}

// For time-filter and sort comparisons only: a show starting after midnight
// (00:00-04:59) is a LATE show — it belongs after the evening, not before it.
// Bump its hour past 24 so "00:30" compares/sorts as "24:30" (later than 9pm),
// instead of "00:30" reading as the earliest show of the day.
function to24hSortable(timeStr) {
  const t24 = to24h(timeStr);
  if (!t24) return t24;
  const h = parseInt(t24.slice(0, 2), 10);
  return h < 5 ? `${h + 24}:${t24.slice(3)}` : t24;
}

// Normalize display time to "6:45 PM" format (uppercase AM/PM, no "show" suffix)
function formatTime(timeStr) {
  if (!timeStr) return 'TBD';
  const m = timeStr.match(/(\d+:\d+)\s*(am|pm)/i);
  if (!m) return timeStr;
  return m[1] + ' ' + m[2].toUpperCase();
}

// ---- Past show filter ----
// Returns true if a show's start time is 2+ hours ago (should be hidden)
function isShowPast(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const t24 = to24h(timeStr);
  if (!t24) return false;
  const [h, m] = t24.split(':').map(Number);
  const showDate = new Date(dateStr + 'T00:00:00');
  showDate.setHours(h, m, 0, 0);
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
  return showDate < cutoff;
}

// ---- Venue normalization ----
// Map all venue variants to the 3 main rooms
// Map special show names to their known rooms (from comedycellar.com/#showtimes)
const SPECIAL_SHOW_ROOMS = {
  'cq room': 'Fat Black Pussycat',
  'colin quinn': 'Fat Black Pussycat',
  'robert kelly': 'Fat Black Pussycat',
  'bobby kelly': 'Fat Black Pussycat',
  'jim norton': 'Fat Black Pussycat',
  'new joke night': 'Fat Black Pussycat',
  'hot soup': 'Fat Black Pussycat',
  'chris redd': 'Fat Black Pussycat',
  'sunday brunch': 'MacDougal Street',
};

function normalizeVenue(venue) {
  const v = venue.toLowerCase();
  // Check special show room map FIRST (overrides generic venue strings)
  for (const [key, room] of Object.entries(SPECIAL_SHOW_ROOMS)) {
    if (v.includes(key)) return room;
  }
  if (v.includes('macdougal')) return 'MacDougal Street';
  if (v.includes('fat black') || v.includes('fbpc') || v.includes('pussycat')) return 'Fat Black Pussycat';
  if (v.includes('village underground')) return 'Village Underground';
  return '';
}

// ---- Big Shows venue name cleanup ----
function cleanVenueName(venue) {
  if (!venue) return '';
  // Strip " - New York" / " - NYC" suffixes
  let v = venue.replace(/\s*-\s*New York$/i, '').replace(/\s*-\s*NYC$/i, '').trim();
  // Normalize known variants
  if (/^the\s+town\s+hall$/i.test(v)) v = 'Town Hall';
  if (/apollo.*jonelle|jonelle.*procope/i.test(v)) v = 'Apollo Theater';
  return v;
}

// ---- Show scoring ----
function scoreShow(show) {
  let faves = 0;
  let skips = 0;
  let newFaces = 0;
  for (const name of show.comedians) {
    if (isFav(name) || isLike(name)) faves++;
    else if (isSkip(name)) skips++;
    else newFaces++;
  }
  // Weighted score: faves +2, skips -1, neutrals 0
  const score = (faves * 2) - skips;
  return { faves, likes: 0, skips, newFaces, score };
}

// Date-strip fave badge helpers. scoreShow above is Cellar-flavored and not
// defensive about `.comedians`; these are safe across every source (Stand /
// NYCC / Gotham / Big Shows, including Big Shows' performers-string events).

// Favorited/liked comedians on a single lineup.
function lineupFaves(show) {
  let n = 0;
  for (const name of (show.comedians || [])) {
    if (isFav(name) || isLike(name)) n++;
  }
  return n;
}

// Max lineupFaves across an array of shows (caller pre-filters by date).
function maxLineupFaves(shows) {
  let max = 0;
  for (const s of (shows || [])) {
    const n = lineupFaves(s);
    if (n > max) max = n;
  }
  return max;
}

// All Venues: max faves on any single lineup that date, across every source.
function dayMaxFaves(dateStr) {
  let max = maxLineupFaves(allData[dateStr]);
  const bump = (arr) => {
    if (!arr) return;
    const n = maxLineupFaves(arr.filter(s => s.date === dateStr));
    if (n > max) max = n;
  };
  if (typeof standShows !== 'undefined') bump(standShows);
  if (typeof nyccShows !== 'undefined') bump(nyccShows);
  if (typeof gothamShows !== 'undefined') bump(gothamShows);
  if (typeof bigShows !== 'undefined') bump(bigShows);
  return max;
}

// "3 faves" / "1 fave" badge HTML, empty string if no faves.
function faveBadgeHtml(n) {
  return n >= 1 ? `<span class="tab-badge">${n} fave${n === 1 ? '' : 's'}</span>` : '';
}

// Snap the viewport to the top after a re-render. Instant, not smooth: a
// smooth animation started right after renderShows() rebuilds the DOM gets
// interrupted by image-load reflows, which left the page stranded mid-scroll
// ("sometimes doesn't go to top" when jumping from the footer strip).
function scrollToTop() {
  window.scrollTo(0, 0);
}

// Top date-strip tab click: toggle the day (re-click clears to Full Schedule),
// re-render, then jump to top so the new day's lineups start at the viewport top.
function selectDayTab(dateStr) {
  activeDate = activeDate === dateStr ? 'all' : dateStr;
  renderTabs();
  renderShows();
  scrollToTop();
}

// Footer strip / Full Schedule: jump straight to a day (no toggle), re-render,
// snap to top.
function jumpToDay(dateStr) {
  activeDate = dateStr;
  renderTabs();
  renderShows();
  scrollToTop();
}

// Does a date have any shows in the currently-active venue source? Used when
// switching source tabs to decide whether to keep the selected date or reset
// to Full Schedule (so the user never lands on a blank day).
function dateInActiveSource(dateStr) {
  if (!dateStr || dateStr === 'all') return true;
  switch (activeSource) {
    case 'all':
      return !!(allData[dateStr] && allData[dateStr].length)
        || (typeof standShows !== 'undefined' && standShows.some(s => s.date === dateStr))
        || (typeof nyccShows !== 'undefined' && nyccShows.some(s => s.date === dateStr))
        || (typeof gothamShows !== 'undefined' && gothamShows.some(s => s.date === dateStr))
        || (typeof bigShows !== 'undefined' && bigShows.some(e => e.date === dateStr));
    case 'cellar':
      return !!(allData[dateStr] && allData[dateStr].length);
    case 'the-stand':
      return typeof standShows !== 'undefined' && standShows.some(s => s.date === dateStr);
    case 'big-shows':
      return typeof bigShows !== 'undefined' && bigShows.some(e => e.date === dateStr);
    case 'gotham':
      return typeof gothamShows !== 'undefined' && gothamShows.some(s => s.date === dateStr);
    case 'nycc':
      return typeof nyccShows !== 'undefined' && nyccShows.some(s => s.date === dateStr);
    default:
      return false; // comedians directory etc. — no date concept
  }
}

// ---- Fetch with timeout ----
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ---- Fetch ----
async function fetchDay(dateStr) {
  try {
    const resp = await fetchWithTimeout(`${API_URL}?date=${dateStr}`, {}, 15000);

    const data = await resp.json();
    const html = data?.show?.html || '';
    if (!html) return [];
    return parseShows(html, dateStr);
  } catch (e) {
    console.error(`Failed to fetch ${dateStr}:`, e);
    return null;
  }
}

// ---- The Stand fetch ----
let standShows = [];

async function fetchTheStand() {
  try {
    // Try prebaked static data first (CDN, no function invocation)
    const resp = await fetchWithTimeout(STATIC_STAND, {}, 5000)
      .catch(() => fetchWithTimeout('/api/the-stand', {}, 15000));
    const data = await resp.json();
    standShows = data.shows || [];
    // Extract comedian photos from Stand data into venue-specific map
    // Apply NAME_FIXES so normalized names get the right photos
    standShows.forEach(show => {
      if (show.comedianPhotos) {
        Object.entries(show.comedianPhotos).forEach(([rawName, url]) => {
          if (url) {
            const name = NAME_FIXES[rawName] || rawName;
            if (!comedianPhotosStand[name]) comedianPhotosStand[name] = url;
            if (!comedianPhotos[name]) comedianPhotos[name] = url;
            // Also store under raw name for backward compat
            if (rawName !== name) {
              if (!comedianPhotosStand[rawName]) comedianPhotosStand[rawName] = url;
            }
          }
        });
      }
    });
    return standShows;
  } catch (e) {
    console.error('Failed to fetch The Stand:', e);
    return [];
  }
}

// ---- Big Shows (SeatGeek) fetch ----
let bigShows = [];
let nyccShows = [];
let gothamShows = [];

async function fetchNYCC() {
  try {
    const resp = await fetchWithTimeout(STATIC_NYCC, {}, 5000)
      .catch(() => fetchWithTimeout('/api/nycc', {}, 15000));
    const data = await resp.json();
    // Drop past shows — the NYCC feed/cache retains weeks-old dates, which
    // otherwise pollute the All-Venues date strip and show list.
    nyccShows = (data.shows || []).filter(s => !isShowPast(s.date, s.time));
    return nyccShows;
  } catch (e) {
    console.error('Failed to fetch NYCC:', e);
    return [];
  }
}

function renderNYCCShows(container) {
  container.classList.remove('picture-mode');
  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  if (nyccShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading NY Comedy Club shows...<br><a href="https://newyorkcomedyclub.com/shows" target="_blank" style="color:var(--accent);font-size:13px;margin-top:8px;display:inline-block;">View on their site →</a></div>';
    return;
  }

  const filteredNYCC = nyccShows.filter(s => !isShowPast(s.date, s.time));
  let html = '<div class="schedule-view">';
  html += '<h2 class="schedule-day-header">NY Comedy Club</h2>';
  filteredNYCC.forEach(show => {
    html += `
      <div class="show-card">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span></div>
          <span class="show-name">${show.title}</span>
          <span class="show-venue">NY Comedy Club</span>
        </div>
        <div class="show-footer">
          ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
          <span class="fav-count">${show.date || ''}</span>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
}

async function fetchGotham() {
  try {
    const resp = await fetchWithTimeout(STATIC_GOTHAM, {}, 5000)
      .catch(() => fetchWithTimeout('/api/gotham', {}, 15000));
    const data = await resp.json();
    gothamShows = data.shows || [];
    return gothamShows;
  } catch (e) {
    console.error('Failed to fetch Gotham:', e);
    return [];
  }
}

async function fetchBigShows() {
  try {
    // Try static cache first (prebaked SeatGeek + Ticketmaster merged)
    const resp = await fetchWithTimeout(STATIC_BIG_SHOWS, {}, 5000)
      .catch(async () => {
        // Live fallback: fetch both APIs and merge
        const [sgResp, tmResp] = await Promise.all([
          fetchWithTimeout('/api/big-shows', {}, 15000).catch(() => null),
          fetchWithTimeout('/api/ticketmaster', {}, 15000).catch(() => null),
        ]);
        const sgData = sgResp ? await sgResp.json() : { events: [] };
        const tmData = tmResp ? await tmResp.json() : { events: [] };
        // Merge: attach TM URLs to matching SG events, add unique TM events
        const sgKeyToIdx = new Map();
        const merged = sgData.events.map(e => ({ ...e, ticketLinks: [{ source: 'seatgeek', url: e.url }] }));
        merged.forEach((e, i) => {
          sgKeyToIdx.set(e.title.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + e.date, i);
          if (e.performers) e.performers.split(', ').forEach(p => sgKeyToIdx.set(p.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + e.date, i));
        });
        tmData.events.forEach(e => {
          const k = e.title.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + e.date;
          const pKeys = e.performers ? e.performers.split(', ').map(p => p.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + e.date) : [];
          let idx = sgKeyToIdx.get(k);
          if (idx === undefined) for (const pk of pKeys) { idx = sgKeyToIdx.get(pk); if (idx !== undefined) break; }
          if (idx !== undefined) {
            if (!merged[idx].ticketLinks.some(l => l.source === 'ticketmaster')) {
              merged[idx].ticketLinks.push({ source: 'ticketmaster', url: e.url });
            }
            if (!merged[idx].price && e.price) merged[idx].price = e.price;
            if (!merged[idx].eventImage && e.eventImage) merged[idx].eventImage = e.eventImage;
          } else {
            merged.push({ ...e, ticketLinks: [{ source: 'ticketmaster', url: e.url }] });
          }
        });
        return new Response(JSON.stringify({ events: merged }));
      });
    const data = await resp.json();
    bigShows = data.events || [];
    return bigShows;
  } catch (e) {
    console.error('Failed to fetch big shows:', e);
    return [];
  }
}

// ---- Availability (sold out detection) ----
async function fetchAvailability() {
  try {
    const resp = await fetchWithTimeout(STATIC_AVAILABILITY, {}, 5000);
    const data = await resp.json();
    availabilityData = data.availability || {};
  } catch (e) {
    // Static cache not available — sold out badges just won't show
    // Availability cache not loaded — sold out badges won't show
  }
}

// Check if a Cellar show is sold out by matching date + time
function isShowSoldOut(dateStr, showTime) {
  const dayAvail = availabilityData[dateStr];
  if (!dayAvail || !Array.isArray(dayAvail)) return false;
  // Match by show time — parse "6:45 pm" to "18:45:00"
  const normalized = normalizeTimeTo24(showTime);
  const match = dayAvail.find(s => s.time === normalized);
  return match ? match.soldout : false;
}

function getSeatsLeft(dateStr, showTime) {
  const dayAvail = availabilityData[dateStr];
  if (!dayAvail || !Array.isArray(dayAvail)) return null;
  const normalized = normalizeTimeTo24(showTime);
  const match = dayAvail.find(s => s.time === normalized);
  return match ? match.seatsLeft : null;
}

function getCoverPrice(dateStr, showTime) {
  const dayAvail = availabilityData[dateStr];
  if (!dayAvail || !Array.isArray(dayAvail)) return null;
  const normalized = normalizeTimeTo24(showTime);
  const match = dayAvail.find(s => s.time === normalized);
  return match ? match.cover : null;
}

// Convert "6:45 pm" / "6:45 PM" to "18:45:00"
function normalizeTimeTo24(timeStr) {
  if (!timeStr) return '';
  const clean = timeStr.toLowerCase().replace(/\s*show\s*/i, '').trim();
  const m = clean.match(/(\d{1,2}):(\d{2})\s*(am|pm)/);
  if (!m) return '';
  let h = parseInt(m[1]);
  const min = m[2];
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}:00`;
}

// ---- State ----
let allData = {};
let activeDate = null;
let dates = [];
let allComediansSeen = new Set();
let activeVenue = 'all'; // venue filter
let activeStandRoom = 'all'; // Stand room filter
let activeSource = 'all'; // venue source tab — default to All Venues
let activeNeighborhood = 'all'; // All Venues tab: all/downtown/midtown/uptown

// ---- Render ----
function renderTabs() {
  const nav = document.getElementById('day-tabs');
  nav.innerHTML = '';

  nav.style.display = '';

  // "Full Schedule" tab first (far left)
  const allTab = document.createElement('button');
  allTab.className = 'day-tab' + (activeDate === 'all' ? ' active' : '');
  allTab.innerHTML = `<span class="tab-day">Full</span><span class="tab-date">Schedule</span>`;
  allTab.addEventListener('click', () => jumpToDay('all'));
  nav.appendChild(allTab);

  if (activeSource === 'the-stand') {
    // The Stand has its own date grouping
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      const maxFavs = maxLineupFaves(standShows.filter(s => s.date === dateStr));
      tab.innerHTML = `
        <span class="tab-day">${getDayName(d)}</span>
        <span class="tab-date">${getDateLabel(d)}</span>
        ${faveBadgeHtml(maxFavs)}
      `;
      tab.addEventListener('click', () => selectDayTab(dateStr));
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'big-shows') {
    const bigDates = [...new Set(bigShows.map(e => e.date))].sort();
    bigDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      const maxFavs = maxLineupFaves(bigShows.filter(e => e.date === dateStr));
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>${faveBadgeHtml(maxFavs)}`;
      tab.addEventListener('click', () => selectDayTab(dateStr));
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'gotham') {
    const gothamDates = [...new Set(gothamShows.map(s => s.date))].sort();
    gothamDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      const maxFavs = maxLineupFaves(gothamShows.filter(s => s.date === dateStr));
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>${faveBadgeHtml(maxFavs)}`;
      tab.addEventListener('click', () => selectDayTab(dateStr));
      nav.appendChild(tab);
    });
    return;
  }

  // For All Venues, build the date strip from the union of every venue's dates so
  // future Stand / Big Shows / NYCC / Gotham dates aren't hidden behind the 7-day Cellar window.
  // Cap at 12 months out — drops TBD/placeholder events (some sources emit dates 5 years ahead).
  let renderDates = dates;
  if (activeSource === 'all') {
    const cap = new Date(); cap.setFullYear(cap.getFullYear() + 1);
    const capStr = cap.toISOString().split('T')[0];
    // Floor at today. A source's cache can carry weeks-old dates (NYCC's does) —
    // without this lower bound they sort to the front of the strip and shove the
    // current dates off-screen. Upper cap drops far-future TBD placeholders.
    const todayStr = formatDateParam(new Date());
    const inRange = (d) => d && d >= todayStr && d <= capStr;
    const union = new Set(dates.map(formatDateParam));
    standShows.forEach(s => inRange(s.date) && union.add(s.date));
    nyccShows.forEach(s => inRange(s.date) && union.add(s.date));
    if (typeof gothamShows !== 'undefined') gothamShows.forEach(s => inRange(s.date) && union.add(s.date));
    bigShows.forEach(e => inRange(e.date) && union.add(e.date));
    renderDates = [...union].sort().map(s => new Date(s + 'T12:00:00'));
  }

  renderDates.forEach(d => {
    const dateStr = formatDateParam(d);
    const tab = document.createElement('button');
    const shows = allData[dateStr];
    const hasCellar = shows && shows.length > 0;
    let noLineup;
    if (activeSource === 'all') {
      // All Venues: check all sources
      noLineup = !hasCellar && !standShows.some(s => s.date === dateStr) && !nyccShows.some(s => s.date === dateStr) && !gothamShows.some(s => s.date === dateStr) && !bigShows.some(e => e.date === dateStr);
    } else {
      // Cellar tab (default): only check Cellar data
      noLineup = !hasCellar;
    }
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    // All Venues: count faves across every source. Cellar tab: Cellar shows only.
    const maxFavs = activeSource === 'all'
      ? dayMaxFaves(dateStr)
      : maxLineupFaves(shows);

    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
      ${faveBadgeHtml(maxFavs)}
    `;

    tab.addEventListener('click', () => selectDayTab(dateStr));
    nav.appendChild(tab);
  });
}

let moreDaysLoaded = false;
async function loadMoreDays() {
  const now = new Date();
  const extraDates = [];
  for (let i = 30; i < 60; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    extraDates.push(d);
  }
  try {
    const resp = await fetchWithTimeout(`${API_BATCH_URL}?days=60&skip=30`, {}, 15000);
    const batchData = await resp.json();
    extraDates.forEach(d => {
      const dateStr = formatDateParam(d);
      const dayData = batchData?.results?.[dateStr];
      const html = dayData?.show?.html || '';
      if (html) {
        allData[dateStr] = parseShows(html, dateStr);
        allData[dateStr].forEach(show => {
          show.comedians.forEach(name => allComediansSeen.add(name));
        });
      } else {
        allData[dateStr] = null;
      }
    });
    dates.push(...extraDates);
    moreDaysLoaded = true;
    renderTabs();
    renderShows();
  } catch (e) {
    console.error('Failed to load more days:', e);
  }
}

// ---- Calendar Picker ----
let calendarOpen = false;
let calendarSelectedDates = new Set();

function initCalendar() {
  const btn = document.getElementById('calendar-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    calendarOpen = !calendarOpen;
    btn.classList.toggle('active', calendarOpen);
    renderCalendar();
  });
}

function renderCalendar() {
  const picker = document.getElementById('calendar-picker');
  if (!picker) return;
  if (!calendarOpen) { picker.style.display = 'none'; return; }
  picker.style.display = 'block';

  const today = new Date();
  today.setHours(0,0,0,0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 13); // 14 days default

  // Hard cap any source's "latest" date at 12 months from today — drops TBD/placeholder events
  // (e.g. SeatGeek emits 2031-03-20 for ongoing shows with no real date yet).
  const HARD_CAP = new Date(today); HARD_CAP.setFullYear(HARD_CAP.getFullYear() + 1);
  const capStr = HARD_CAP.toISOString().split('T')[0];
  const safeMax = (d) => d && d <= capStr ? d : '';

  // Every date that has shows in the ACTIVE source — drives both the max-date
  // extension below and the .no-shows greying further down, so the calendar
  // always matches whatever venue tab you're on.
  const sourceDates = (() => {
    const cellar = () => Object.keys(allData).filter(d => allData[d] && allData[d].length > 0);
    const arr = (a) => (typeof a !== 'undefined' ? a : []).map(s => s.date).filter(Boolean);
    switch (activeSource) {
      case 'cellar':    return cellar();
      case 'the-stand': return arr(standShows);
      case 'big-shows': return arr(bigShows);
      case 'gotham':    return arr(typeof gothamShows !== 'undefined' ? gothamShows : undefined);
      case 'nycc':      return arr(typeof nyccShows !== 'undefined' ? nyccShows : undefined);
      default:          return [
        ...cellar(),
        ...arr(standShows),
        ...arr(bigShows),
        ...arr(typeof nyccShows !== 'undefined' ? nyccShows : undefined),
        ...arr(typeof gothamShows !== 'undefined' ? gothamShows : undefined),
      ];
    }
  })();

  // Extend the calendar's max date (default 14-day window) to the latest event
  // in the active source so far-out shows stay reachable.
  const latestInSource = sourceDates.reduce((max, d) => {
    const s = safeMax(d);
    return s > max ? s : max;
  }, '');
  if (latestInSource) {
    const latestDate = new Date(latestInSource + 'T12:00:00');
    if (latestDate > maxDate) maxDate.setTime(latestDate.getTime());
  }

  // Find the Monday of the week containing today
  const startOfWeek = new Date(today);
  const dow = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - ((dow + 6) % 7)); // Monday

  // End on Sunday of the week containing the LAST DAY of maxDate's month — never spill
  // into a month with no events.
  const endOfMonth = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0);
  const endOfWeek = new Date(endOfMonth);
  const edow = endOfWeek.getDay();
  if (edow !== 0) endOfWeek.setDate(endOfWeek.getDate() + (7 - edow));

  let html = '<div class="calendar-grid">';

  let lastMonth = -1;
  let lastYear = -1;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Add initial month + day headers
  const cursor = new Date(startOfWeek);
  lastMonth = cursor.getMonth();
  lastYear = cursor.getFullYear();
  html += `<div class="cal-month-label">${monthNames[lastMonth]} ${lastYear}</div>`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => {
    html += `<div class="cal-header">${d}</div>`;
  });

  // Dates with shows in the active source (computed above) — days in range but
  // not in this set get struck through (.no-shows).
  const datesWithShows = new Set(sourceDates);

  while (cursor <= endOfWeek) {
    // Month separator row when month changes (at start of a week / Monday)
    if (cursor.getMonth() !== lastMonth && cursor.getDay() === 1) {
      lastMonth = cursor.getMonth();
      lastYear = cursor.getFullYear();
      html += `<div class="cal-month-label">${monthNames[lastMonth]} ${lastYear}</div>`;
    }
    const dateStr = cursor.toISOString().split('T')[0];
    const isToday = cursor.getTime() === today.getTime();
    const inRange = cursor >= today && cursor <= maxDate;
    const isSelected = calendarSelectedDates.has(dateStr);
    const hasNoShows = inRange && !datesWithShows.has(dateStr);
    const classes = ['cal-day'];
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');
    if (!inRange) classes.push('disabled');
    if (hasNoShows) classes.push('no-shows');
    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${cursor.getDate()}</div>`;
    cursor.setDate(cursor.getDate() + 1);
  }
  html += '</div>';
  html += '<div class="calendar-actions">';
  html += '<button onclick="calendarClear()">Clear</button>';
  html += '<button class="primary" onclick="calendarApply()">Show selected</button>';
  html += '</div>';

  picker.innerHTML = html;

  // Click handlers for day cells.
  // Plain click = single-select + auto-apply + close. Cmd/Shift-click = additive multi-select (use Show selected).
  picker.querySelectorAll('.cal-day:not(.disabled)').forEach(cell => {
    cell.addEventListener('click', (e) => {
      const d = cell.dataset.date;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      if (additive) {
        if (calendarSelectedDates.has(d)) calendarSelectedDates.delete(d);
        else calendarSelectedDates.add(d);
        cell.classList.toggle('selected');
        return;
      }
      // Single-tap → replace selection with this date and apply immediately.
      calendarSelectedDates.clear();
      calendarSelectedDates.add(d);
      calendarApply();
    });
  });
}

function calendarClear() {
  calendarSelectedDates.clear();
  // Reset to default view
  activeDate = 'all';
  renderCalendar();
  renderTabs();
  renderShows();
}

async function calendarApply() {
  if (calendarSelectedDates.size === 0) return calendarClear();

  // Ensure all selected dates have data loaded
  const needed = [...calendarSelectedDates].filter(d => !(d in allData));
  if (needed.length > 0) {
    // Fetch missing days via batch
    try {
      const resp = await fetchWithTimeout(
        `${API_BATCH_URL}?days=60`, {}, 15000
      );
      const batchData = await resp.json();
      for (const dateStr of needed) {
        const dayData = batchData?.results?.[dateStr];
        const html = dayData?.show?.html || '';
        if (html) {
          allData[dateStr] = parseShows(html, dateStr);
          allData[dateStr].forEach(show => {
            show.comedians.forEach(name => allComediansSeen.add(name));
          });
        } else {
          allData[dateStr] = null;
        }
        // Add to dates array if not present
        const d = new Date(dateStr + 'T12:00:00');
        if (!dates.find(dd => formatDateParam(dd) === dateStr)) {
          dates.push(d);
          dates.sort((a, b) => a - b);
        }
      }
      moreDaysLoaded = true;
    } catch (e) {
      console.error('Failed to fetch calendar dates:', e);
    }
  }

  // If exactly 1 date selected, go to that day tab
  if (calendarSelectedDates.size === 1) {
    activeDate = [...calendarSelectedDates][0];
  } else {
    // Multi-select: set to 'all' and filter in render
    activeDate = 'calendar';
  }

  calendarOpen = false;
  document.getElementById('calendar-btn')?.classList.remove('active');
  renderCalendar();
  renderTabs();
  renderShows();
}

// ---- Venue Source Tab Rendering ----
function renderSourceTabs() {
  const container = document.getElementById('venue-source-tabs');
  container.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === activeSource);
  });

  // Update counts
  const cellarCount = Object.values(allData).flat().filter(Boolean).length;
  const standCount = standShows.length;
  const bigCount = bigShows.length;

  container.querySelectorAll('.venue-source-tab').forEach(btn => {
    const src = btn.dataset.source;
    let count = 0;
    if (src === 'cellar') count = cellarCount;
    else if (src === 'the-stand') count = standCount;
    else if (src === 'big-shows') count = bigCount;
    else if (src === 'gotham') count = gothamShows.length;
    const existing = btn.querySelector('.source-count');
    if (existing) existing.remove();
    if (count > 0) {
      btn.insertAdjacentHTML('beforeend', `<span class="source-count">(${count})</span>`);
    }
  });
}

// Insert filter banner at top of container AFTER content has been rendered
function _insertFilterBanner(container) {
  const old = document.getElementById('comedian-filter-banner-wrap');
  if (old) old.remove();
  if (!activeComedianFilter && !activeSearchQuery) return;
  const wrap = document.createElement('div');
  wrap.id = 'comedian-filter-banner-wrap';
  wrap.className = 'comedian-filter-banner-wrap';
  const banner = document.createElement('div');
  banner.id = 'comedian-filter-banner';
  banner.className = 'comedian-filter-banner';
  if (activeComedianFilter) {
    banner.innerHTML = `Showing shows with <strong>${activeComedianFilter}</strong> <button onclick="filterByComedian('${activeComedianFilter.replace(/'/g, "\\'")}')">${ICON.x} Clear</button>`;
  } else {
    const safe = activeSearchQuery.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    banner.innerHTML = `Search: <strong>${safe}</strong> <button onclick="clearSearch()">${ICON.x} Clear</button>`;
  }
  wrap.appendChild(banner);
  container.prepend(wrap);
}

function renderShows() {
  const container = document.getElementById('shows-container');

  // Neighborhood filter lives in the Filters dropdown; only relevant on All Venues.
  const nbSel = document.getElementById('neighborhood-filter');
  if (nbSel) {
    nbSel.style.display = activeSource === 'all' ? '' : 'none';
    nbSel.value = activeNeighborhood;
  }

  // Toggle directory-mode body class for CSS-based hiding of irrelevant filters
  document.body.classList.toggle('dir-mode', activeSource === 'comedians');

  // Route to correct renderer based on active source
  if (activeSource === 'the-stand') {
    renderTheStandShows(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'big-shows') {
    renderBigShows(container);
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'comedians') {
    // Comedians directory has its own controls; the bottom-tabs "Full Schedule" + day picker
    // is irrelevant here, so kill any stale nav from previous renders.
    const stale = document.getElementById('bottom-tabs');
    if (stale) stale.remove();
    renderComedianDirectory(container);
    return;
  }
  if (activeSource === 'all') {
    renderAllVenues(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'nycc') {
    renderNYCCShows(container);
    return;
  }
  if (activeSource === 'gotham') {
    renderGothamShows(container);
    return;
  }

  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves').checked;
  const pictureMode = document.getElementById('picture-mode')?.checked;

  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Always render venue filters
  const allShowsFlat = Object.values(allData).flat().filter(Boolean);
  renderVenueFilters(allShowsFlat);

  // Sort dropdown — if sorting, always use per-showtime view (across all days)
  const sortVal = document.getElementById('sort-select')?.value || 'none';
  if (sortVal === 'faves') {
    renderSortedByFaves(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }


  // "All" or "calendar" schedule view — show all/selected days
  if (activeDate === 'all' || activeDate === 'calendar') {
    renderAllDaysSchedule(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }

  const shows = allData[activeDate];

  if (shows === null) {
    container.innerHTML = '<div class="no-shows">Could not load lineup. Try refreshing.</div>';
    return;
  }

  if (!shows || shows.length === 0) {
    // Figure out which day this is to give a helpful message
    const d = new Date(activeDate + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    let hint = '';
    if (dow >= 1 && dow <= 4) {
      // Mon-Thu: weekday lineups post day-of or day-before
      hint = 'Check back — weekday lineups usually drop the day before.';
    } else {
      // Fri-Sun: weekend lineups post Thursday
      hint = 'Check back Thursday — that\'s when weekend lineups are posted.';
    }
    container.innerHTML = `<div class="no-shows">No lineup posted yet for this day.<br><span style="font-size:13px;color:var(--text-dim);margin-top:6px;display:inline-block;">${hint}</span></div>`;
    return;
  }

  const prefs = loadPrefs();
  const hasAnyPrefs = prefs.faves.length > 0 || prefs.skips.length > 0 || prefs.likes.length > 0;

  let sorted = shows;

  let html = '';

  // Onboarding banner — commented out for now (revisit later)
  // if (!hasAnyPrefs && !localStorage.getItem('onboard-dismissed')) {
  //   html += `
  //     <div class="onboard-banner" id="onboard-banner">
  //       <p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
  //       <button class="onboard-btn" onclick="openModal()">Set Up</button>
  //       <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
  //     </div>
  //   `;
  // }

  html += sorted.map(show => renderShowCard(show, hideSkips, onlyFavs, activeDate)).join('');

  container.innerHTML = html;

  // Render bottom nav tabs
  renderBottomTabs();
  _insertFilterBanner(container);
}

function showTitlePopup(el) {
  if (el.scrollWidth <= el.clientWidth) return; // not truncated, no popup needed
  const popup = document.createElement('div');
  popup.className = 'big-show-title-popup';
  popup.textContent = el.title || el.textContent;
  document.body.appendChild(popup);
  const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
  requestAnimationFrame(() => document.addEventListener('click', dismiss));
}

// Sold-out filter mode: 'all' (default), 'hide' (skip sold-out), 'only' (skip not-sold-out).
function getSoldOutFilter() {
  return document.getElementById('soldout-filter')?.value || 'all';
}
function shouldHideShow(isSoldOut) {
  const f = getSoldOutFilter();
  if (f === 'hide' && isSoldOut) return true;
  if (f === 'only' && !isSoldOut) return true;
  return false;
}
// Inline per-card toggle replaced by the toolbar dropdown — keep stub for compatibility.
function hideSoldOutToggle() { return ''; }

function toggleHideSoldOut() {
  const cb = document.getElementById('hide-sold-out');
  if (!cb) return;
  // Poof animation on all sold-out cards
  const cards = document.querySelectorAll('.show-card.sold-out, .big-show-card.sold-out');
  cards.forEach(c => c.classList.add('poof'));
  // Highlight the toolbar toggle
  const toolbarLabel = cb.closest('label');
  if (toolbarLabel) toolbarLabel.classList.add('toggle-highlight');
  setTimeout(() => {
    cb.checked = true;
    updateResetBtn();
    renderShows();
    if (toolbarLabel) setTimeout(() => toolbarLabel.classList.remove('toggle-highlight'), 1200);
  }, 500);
}

// ---- Shared show card renderer ----
function renderShowCard(show, hideSkips, onlyFavs, dateStr) {
  try {
  // Comedian filter
  if (activeComedianFilter && !show.comedians.some(c => c.toLowerCase() === activeComedianFilter.toLowerCase())) return '';
  if (!showMatchesSearch(show, 'Comedy Cellar')) return '';

  // Hide past shows (2+ hours ago)
  const showDateStr = dateStr || activeDate;
  if (showDateStr && showDateStr !== 'all' && showDateStr !== 'calendar' && isShowPast(showDateStr, show.time)) return '';

  // Venue filter (compare against normalized venue name)
  if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return '';

  // Time filter (range)
  const timeFilter = document.getElementById('time-filter')?.value;
  const timeFilterMin = window._timeFilterMin;
  const showTime24_tf = to24hSortable(show.time);
  if (timeFilter && timeFilter !== 'any' && showTime24_tf && showTime24_tf > timeFilter) return '';
  if (timeFilterMin && showTime24_tf && showTime24_tf < timeFilterMin) return '';

  const stats = scoreShow(show);
  const hasFavOrLike = stats.faves > 0 || stats.likes > 0;

  if (onlyFavs && !hasFavOrLike) return '';

  // Hide entire show if any comedian is a skip
  if (hideSkips && stats.skips > 0) return '';

  const comediansHtml = renderComedianChips(show.comedians, hideSkips, 'cellar');

  let badge = '';
  const totalScore = stats.faves + stats.likes;
  if (stats.faves >= 3) {
    badge = `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
  } else if (stats.faves >= 2) {
    badge = `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;
  }

  const soldOut = dateStr ? isShowSoldOut(dateStr, show.time) : false;
  if (shouldHideShow(soldOut)) return '';
  const cardClass = (stats.faves >= 3 ? 'show-card must-go' : 'show-card') + (soldOut ? ' sold-out' : '');

  // Detect named/special shows vs plain venue variants
  const normalizedVenue = normalizeVenue(show.venue);
  const venueStart = show.venue.toLowerCase();
  const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');

  return `
    <div class="${cardClass}" data-venue-source="cellar">
      <div class="show-header">
        <div>
          <span class="show-time">${formatTime(show.time)}</span>
          ${badge}
        </div>
        ${!isPlainVenue ? (getCellarPoster(show.venue) ? `<span class="show-name poster-wrap">Comedy Cellar: ${show.venue}<img class="poster-preview" src="${getCellarPoster(show.venue)}" alt="${show.venue}"></span>` : `<span class="show-name">Comedy Cellar: ${show.venue}</span>`) : '<span class="show-name">Comedy Cellar</span>'}
        <span class="show-venue">${normalizedVenue}</span>
      </div>
      <div class="show-lineup">${comediansHtml}</div>
      <div class="show-footer">
        ${show.reserveUrl
          ? `<span class="reserve-group"><a href="${show.reserveUrl}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Reserve'}</a>${soldOut ? '<span class="standby-note">Standby list opens 1 hr before</span>' : ''}</span>`
          : '<span></span>'}
        ${soldOut ? hideSoldOutToggle(soldOut) : `<span class="fav-count">${stats.faves > 0 ? `${ICON.starFilled} ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}</span>`}
      </div>
    </div>
  `;
  } catch (e) { console.error('renderShowCard error:', e, show); return ''; }
}

// ---- Shared comedian chip renderer ----
// venueSource: 'cellar', 'stand', 'gotham', 'nycc', 'big' — used for bio priority
function renderComedianChips(comedians, hideSkips, venueSource) {
  const showPhotos = document.getElementById('show-photos')?.checked ?? true;
  const expandBios = document.getElementById('expand-bios')?.checked;
  const expandLongBios = document.getElementById('expand-long-bios')?.checked;
  const noPhotoFilter = document.getElementById('no-photo-filter')?.checked;

  return comedians.map(name => {
    const favd = isFav(name);
    const skipped = isSkip(name);
    const liked = isLike(name);
    let cls = 'comedian';
    if (activeComedianFilter && name.toLowerCase() === activeComedianFilter.toLowerCase()) cls += ' filter-highlight';
    let prefix = '';

    if (favd) {
      cls += ' fav';
      prefix = `<span class="star">${ICON.starFilled}</span>`;
    } else if (liked) {
      // Legacy likes treated as faves
      cls += ' fav';
      prefix = `<span class="star">${ICON.starFilled}</span>`;
    } else if (skipped) {
      cls += ' skip';
      if (hideSkips) cls += ' hidden-skip';
    } else {
      cls += ' new-face';
    }

    const photoUrl = getPhotoForVenue(name, venueSource || 'cellar');
    const hasPhoto = !!photoUrl;
    // No-photo filter: hide comedians that have photos, highlight those without
    if (noPhotoFilter && hasPhoto) return '';
    if (noPhotoFilter && !hasPhoto) cls += ' no-photo-highlight';
    const photoHtml = showPhotos
      ? (photoUrl
          ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy" onerror="window.swapPhotoPlaceholder(this)">`
          : `<span class="comedian-photo comedian-photo-placeholder">${ICON.mic}</span>`)
      : '';
    // Get venue-aware bio
    const tagline = getBioForVenue(name, venueSource || 'cellar');
    const titleAttr = tagline ? ` title="${tagline.replace(/"/g, '&quot;')}"` : '';

    // Long bios: show full bio panel inline for every comedian
    if (expandLongBios && !window.V2_MODE && !window.V3_MODE) {
      if (!tagline) {
        return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
          <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${name}${prefix}</span>
        </div>`;
      }
      return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
        <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${name}${prefix}</span>
        <div class="comedian-long-bio">${tagline}</div>
      </div>`;
    }

    // Short bios: show tagline below name
    if (expandBios && !window.V2_MODE && !window.V3_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline-inline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}<span class="comedian-name-wrap">${name}${prefix}${taglineHtml}</span></span>`;
    }

    // v2 card mode: show tagline text below name
    if (window.V2_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}<span class="comedian-name">${name}</span>${prefix}${taglineHtml}</span>`;
    }

    return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${name}${prefix}</span>`;
  }).join('');
}

function renderSortedByFaves(container) {
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves')?.checked;

  // Collect all shows from all days with their date
  let allShows = [];
  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    if (!shows) return;
    shows.forEach(show => {
      if (isShowPast(dateStr, show.time)) return;
      if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return;
      const stats = scoreShow(show);
      if (onlyFavs && stats.faves === 0 && stats.likes === 0) return;
      // Hide entire show if any comedian is a skip
      if (hideSkips && stats.skips > 0) return;
      const timeFilter = document.getElementById('time-filter')?.value;
      const timeFilterMin2 = window._timeFilterMin;
      const showTime24_sf = to24hSortable(show.time);
      if (timeFilter && timeFilter !== 'any' && showTime24_sf && showTime24_sf > timeFilter) return;
      if (timeFilterMin2 && showTime24_sf && showTime24_sf < timeFilterMin2) return;
      const soldOut = isShowSoldOut(dateStr, show.time);
      if (shouldHideShow(soldOut)) return;
      allShows.push({ ...show, dateStr, dateObj: d, faves: stats.faves, score: stats.score, stats, soldOut });
    });
  });

  // Sort by weighted score (faves*2 - skips), then by fave count, then chronologically
  allShows.sort((a, b) => b.score - a.score || b.faves - a.faves || a.dateStr.localeCompare(b.dateStr) || (a.time || '').localeCompare(b.time || ''));

  if (allShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows match your filters.</div>';
    renderBottomTabs();
    return;
  }

  let lastDateStr = '';
  let html = '<div class="schedule-view">';

  allShows.forEach(show => {
    try {
    const stats = show.stats;
    const dayLabel = getDayHeaderLabel(show.dateObj);
    if (show.dateStr !== lastDateStr) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDateStr = show.dateStr;
    }

    const soldOut = show.soldOut;
    const cardClass = (stats.faves >= 3 ? 'show-card must-go' : 'show-card') + (soldOut ? ' sold-out' : '');
    let badge = '';
    if (stats.faves >= 3) badge += `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
    else if (stats.faves >= 2) badge += `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;
    if (stats.likes > 0) badge += ` <span class="show-badge badge-likes">${stats.likes} LIKE${stats.likes > 1 ? 'S' : ''}</span>`;

    const normalizedVenue = normalizeVenue(show.venue);
    const venueStart = show.venue.toLowerCase();
    const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
    const chips = renderComedianChips(show.comedians, hideSkips, 'cellar');

    html += `
      <div class="${cardClass}" data-venue-source="cellar">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span>${badge}</div>
          ${!isPlainVenue ? (getCellarPoster(show.venue) ? `<span class="show-name poster-wrap">Comedy Cellar: ${show.venue}<img class="poster-preview" src="${getCellarPoster(show.venue)}" alt="${show.venue}"></span>` : `<span class="show-name">Comedy Cellar: ${show.venue}</span>`) : '<span class="show-name">Comedy Cellar</span>'}
          <span class="show-venue">${normalizedVenue}</span>
        </div>
        <div class="show-lineup">${chips}</div>
        <div class="show-footer">
          ${show.reserveUrl ? `<span class="reserve-group"><a href="${show.reserveUrl}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Reserve'}</a>${soldOut ? '<span class="standby-note">Standby list opens 1 hr before</span>' : ''}</span>` : '<span></span>'}
          ${soldOut ? hideSoldOutToggle(soldOut) : `<span class="fav-count">${stats.faves > 0 ? `${ICON.starFilled} ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''} ${stats.likes > 0 ? `${ICON.thumbsUp} ${stats.likes}` : ''}</span>`}
        </div>
      </div>`;
    } catch (e) { console.error('renderSortedByFaves card error:', e, show); }
  });

  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
}


function renderAllDaysSchedule(container) {
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves')?.checked;
  const sortVal2 = document.getElementById('sort-select')?.value || 'none';
  const shouldSort = sortVal2 === 'faves';
  // Show onboarding if no prefs
  const prefs2 = loadPrefs();
  const hasAnyPrefs2 = prefs2.faves.length > 0 || prefs2.skips.length > 0 || prefs2.likes.length > 0;
  let html = '';
  // Onboarding banner — commented out for now (revisit later)
  // if (!hasAnyPrefs2 && !localStorage.getItem('onboard-dismissed')) {
  //   html += `
  //     <div class="onboard-banner" id="onboard-banner">
  //       <p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
  //       <button class="onboard-btn" onclick="openModal()">Set Up</button>
  //       <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
  //     </div>
  //   `;
  // }
  html += '<div class="schedule-view">';

  // For The Stand, iterate over stand show dates
  if (activeSource === 'the-stand') {
    const timeFilterStand = document.getElementById('time-filter')?.value;
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const dayLabel = getDayHeaderLabel(d);
      let dayShows = standShows.filter(s => s.date === dateStr && !isShowPast(dateStr, s.time));
      if (activeStandRoom !== 'all') {
        dayShows = dayShows.filter(s => {
          return cleanStandRoom(s.room) === activeStandRoom;
        });
      }
      if (timeFilterStand && timeFilterStand !== 'any') {
        dayShows = dayShows.filter(s => {
          const t24 = to24hSortable(s.time);
          return !t24 || t24 <= timeFilterStand;
        });
      }
      const tfMinStand = window._timeFilterMin;
      if (tfMinStand) {
        dayShows = dayShows.filter(s => { const t24 = to24hSortable(s.time); return !t24 || t24 >= tfMinStand; });
      }
      // Filter sold-out shows per dropdown
      dayShows = dayShows.filter(s => !shouldHideShow(isShowSoldOut(s.date, s.time)));
      if (dayShows.length === 0) return;
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      dayShows.forEach(show => {
        try { html += renderStandShowCard(show); } catch (e) { console.error('renderAllDaysSchedule Stand card error:', e, show); }
      });
    });
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  const timeFilterCellar = document.getElementById('time-filter')?.value;

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    // Calendar multi-select: skip days not in selection
    if (activeDate === 'calendar' && !calendarSelectedDates.has(dateStr)) return;
    const shows = allData[dateStr];
    const dayLabel = getDayHeaderLabel(d);

    if (!shows || shows.length === 0) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      const dow = d.getDay();
      let hint = '';
      if (dow >= 1 && dow <= 4) hint = 'Weekday lineups usually drop the day before.';
      else hint = 'Weekend lineups usually post Thursday.';
      html += `<div class="no-shows" style="padding:16px 0;">No lineup posted.${hint ? `<br><span style="font-size:12px;color:var(--text-dim)">${hint}</span>` : ''}</div>`;
      return;
    }

    let sorted = shows;
    if (shouldSort) sorted = [...shows].sort((a, b) => scoreShow(b).score - scoreShow(a).score || scoreShow(b).faves - scoreShow(a).faves);

    let dayHtml = '';
    sorted.forEach(show => {
      try {
        const card = renderShowCard(show, document.getElementById('hide-skips').checked, onlyFavs, dateStr);
        if (card) dayHtml += card;
      } catch (e) { console.error('renderAllDaysSchedule Cellar card error:', e, show); }
    });
    // Only render day header if there are visible shows
    if (dayHtml) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      html += dayHtml;
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

// ---- Stand room helpers ----
function cleanStandRoom(room) {
  if (!room) return 'Main room';
  let r = room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim();
  // Discard street addresses (e.g. "407 W 15th St") — these are venue addresses, not rooms
  if (/^\d+\s/.test(r)) return 'Main room';
  return r || 'Main room';
}

// ---- Stand room filter ----
function renderStandRoomFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'the-stand') return;

  // Get unique rooms from Stand shows
  const rooms = [...new Set(standShows.map(s => cleanStandRoom(s.room)))].sort();

  const allRooms = ['all', ...rooms];
  container.innerHTML = allRooms.map(r => {
    const label = r === 'all' ? 'All Rooms' : r;
    const cls = r === activeStandRoom ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setStandRoom('${r.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setStandRoom(r) {
  activeStandRoom = r;
  updateResetBtn();
  renderShows();
}

// ---- The Stand Renderer ----
function renderTheStandShows(container) {
  const pictureMode = document.getElementById('picture-mode')?.checked;
  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Show Stand room filters
  renderStandRoomFilters();

  if (activeDate === 'all') {
    renderAllDaysSchedule(container);
    return;
  }

  let dayShows = standShows.filter(s => s.date === activeDate);
  if (activeStandRoom !== 'all') {
    dayShows = dayShows.filter(s => {
      const r = s.room ? s.room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim() : 'Main';
      return r === activeStandRoom;
    });
  }
  if (dayShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows for this day.</div>';
    return;
  }

  container.innerHTML = dayShows.map(show => renderStandShowCard(show)).join('');
}

function renderStandShowCard(show) {
  try {
  // Comedian filter
  if (activeComedianFilter && !show.comedians.some(c => c.toLowerCase() === activeComedianFilter.toLowerCase())) return '';
  if (!showMatchesSearch(show, 'The Stand')) return '';

  const soldOut = !!show.soldout;
  if (shouldHideShow(soldOut)) return '';

  const hideSkipsStand = document.getElementById('hide-skips')?.checked;
  // Hide entire show if any comedian is a skip
  if (hideSkipsStand && show.comedians.length > 0 && show.comedians.some(name => isSkip(name))) return '';

  const chips = show.comedians.length > 0
    ? renderComedianChips(show.comedians, hideSkipsStand, 'stand')
    : `<span style="color:var(--text-dim);font-size:13px;">Lineup TBD</span>`;

  // Determine if this is a special/named show vs regular
  let showLabel = 'The Stand';
  if (show.title) {
    const t = show.title.trim();
    const isPresents = /^The Stand Presents?/i.test(t);
    // Check if title is just a comedian's name from the lineup
    const isComedianName = show.comedians.some(c => t.toLowerCase() === c.toLowerCase());
    if (!isPresents && !isComedianName && t.toLowerCase() !== 'the stand') {
      showLabel = 'The Stand: ' + t;
    }
  }

  const shortRoom = cleanStandRoom(show.room);
  const venueText = shortRoom === 'Main' ? 'The Stand' : shortRoom.replace(/\b\w/g, c => c.toUpperCase());

  // Poster hover
  const posterHtml = show.poster
    ? `<span class="show-name poster-wrap">${showLabel}<img class="poster-preview" src="${show.poster}" alt="${showLabel}"></span>`
    : `<span class="show-name">${showLabel}</span>`;

  const cardClass = 'show-card' + (soldOut ? ' sold-out' : '');

  return `
    <div class="${cardClass}" data-venue-source="stand">
      <div class="show-header">
        <div><span class="show-time">${formatTime(show.time)}</span></div>
        ${posterHtml}
        <span class="show-venue">${venueText}</span>
      </div>
      <div class="show-lineup">${chips}</div>
      <div class="show-footer">
        ${show.url ? `<span class="reserve-group"><a href="${show.url}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Tickets'}</a></span>` : '<span></span>'}
        ${soldOut ? hideSoldOutToggle(soldOut) : '<span class="fav-count"></span>'}
      </div>
    </div>
  `;
  } catch (e) { console.error('renderStandShowCard error:', e, show); return ''; }
}

// ---- Gotham Comedy Club Renderer ----
function renderGothamShows(container) {
  container.classList.remove('picture-mode');
  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  if (gothamShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading Gotham Comedy Club shows...<br><a href="https://gothamcomedyclub.com/events" target="_blank" style="color:var(--accent);font-size:13px;margin-top:8px;display:inline-block;">View on their site →</a></div>';
    return;
  }

  let filtered = activeDate === 'all' || activeDate === 'calendar'
    ? (activeDate === 'calendar' ? gothamShows.filter(s => calendarSelectedDates.has(s.date)) : gothamShows)
    : gothamShows.filter(s => s.date === activeDate);
  filtered = filtered.filter(s => !isShowPast(s.date, s.time));
  filtered = filtered.filter(s => showMatchesSearch(s, 'Gotham Comedy Club'));

  let html = '<div class="schedule-view">';
  let lastDate = '';
  filtered.forEach(show => {
    try {
    if (show.date !== lastDate) {
      const d = new Date(show.date + 'T12:00:00');
      html += `<h2 class="schedule-day-header">${getDayHeaderLabel(d)}</h2>`;
      lastDate = show.date;
    }
    html += `
      <div class="show-card">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span></div>
          <span class="show-name">${show.title}</span>
          <span class="show-venue">Gotham${show.price ? ` · $${show.price}` : ''}</span>
        </div>
        ${show.description ? `<div style="padding:8px 16px;font-size:12px;color:var(--text-dim);">${show.description}</div>` : ''}
        <div class="show-footer">
          ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
          <span class="fav-count"></span>
        </div>
      </div>`;
    } catch (e) { console.error('renderGothamShows card error:', e, show); }
  });
  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
}

// ---- Big Shows (SeatGeek) Renderer ----
// ---- All Venues combined view ----
function renderAllVenues(container) {
  const hideSkips = document.getElementById('hide-skips')?.checked;
  const pictureMode = document.getElementById('picture-mode')?.checked;
  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  renderAllVenuesSourceFilter();

  // Show onboarding if no prefs
  const prefsAV = loadPrefs();
  const hasPrefsAV = prefsAV.faves.length > 0 || prefsAV.skips.length > 0 || prefsAV.likes.length > 0;

  // Collect ALL shows into one list with date + sort key
  let allItems = [];

  // Cellar shows
  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    if (activeDate === 'calendar' && !calendarSelectedDates.has(dateStr)) return;
    const shows = allData[dateStr];
    if (!shows) return;
    shows.forEach(show => {
      const time24 = to24hSortable(show.time) || '00:00';
      allItems.push({ type: 'cellar', dateStr, time24, show });
    });
  });

  // Stand shows
  standShows.forEach(show => {
    const time24 = to24hSortable(show.time) || '00:00';
    allItems.push({ type: 'stand', dateStr: show.date, time24, show });
  });

  // Gotham shows
  gothamShows.forEach(show => {
    const time24 = to24hSortable(show.time) || '00:00';
    allItems.push({ type: 'gotham', dateStr: show.date, time24, show });
  });

  // Big Shows
  bigShows.forEach(evt => {
    const time24 = to24hSortable(evt.time) || '00:00';
    allItems.push({ type: 'big', dateStr: evt.date, time24, show: evt });
  });

  // Filter by selected date if not "all"
  if (activeDate === 'calendar') {
    allItems = allItems.filter(item => calendarSelectedDates.has(item.dateStr));
  } else if (activeDate && activeDate !== 'all') {
    allItems = allItems.filter(item => item.dateStr === activeDate);
  }

  // Filter by neighborhood if not "all"
  if (activeNeighborhood !== 'all') {
    allItems = allItems.filter(item => getNeighborhood(item) === activeNeighborhood);
  }

  // Time filter
  const timeFilterAV = document.getElementById('time-filter')?.value;
  if (timeFilterAV && timeFilterAV !== 'any') {
    allItems = allItems.filter(item => !item.time24 || item.time24 <= timeFilterAV);
  }
  const tfMinAV = window._timeFilterMin;
  if (tfMinAV) {
    allItems = allItems.filter(item => !item.time24 || item.time24 >= tfMinAV);
  }

  // Comedian filter
  if (activeComedianFilter) {
    const filterLower = activeComedianFilter.toLowerCase();
    allItems = allItems.filter(item => {
      const comedians = item.show.comedians || [];
      if (comedians.some(c => c.toLowerCase() === filterLower)) return true;
      // Big Shows: check performers field
      if (item.show.performers && item.show.performers.toLowerCase().includes(filterLower)) return true;
      return false;
    });
  }

  // Free-text search across comedians, show names, and venues
  if (activeSearchQuery) {
    allItems = allItems.filter(item => showMatchesSearch(item.show, VENUE_LABEL_BY_TYPE[item.type] || ''));
  }

  // Hide past shows (2+ hours ago)
  allItems = allItems.filter(item => !isShowPast(item.dateStr, item.show.time));

  // Apply sold-out filter (hide / only / all)
  allItems = allItems.filter(item => {
    const soldOut = item.type === 'cellar' ? isShowSoldOut(item.dateStr, item.show.time) : !!item.show.soldout;
    return !shouldHideShow(soldOut);
  });

  // Sort — by faves if dropdown selected, otherwise by date+time
  const sortValAV = document.getElementById('sort-select')?.value || 'none';
  if (sortValAV === 'faves') {
    // Score each item by fave count
    allItems.forEach(item => {
      const comedians = item.show.comedians || [];
      let faves = 0, skips = 0;
      for (const name of comedians) {
        if (isFav(name) || isLike(name)) faves++;
        else if (isSkip(name)) skips++;
      }
      item.faveCount = faves;
      item.score = (faves * 2) - skips;
    });
    allItems.sort((a, b) => b.score - a.score || b.faveCount - a.faveCount || a.dateStr.localeCompare(b.dateStr) || a.time24.localeCompare(b.time24));
  } else {
    allItems.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.time24.localeCompare(b.time24));
  }

  let html = '';
  // Onboarding banner — commented out for now (revisit later)
  // if (!hasPrefsAV && !localStorage.getItem('onboard-dismissed')) {
  //   html += `<div class="onboard-banner"><p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p><button class="onboard-btn" onclick="openModal()">Set Up</button><button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button></div>`;
  // }
  html += '<div class="schedule-view">';
  let lastDate = '';

  allItems.forEach(item => {
    try {
    if (item.dateStr !== lastDate) {
      const d = new Date(item.dateStr + 'T12:00:00');
      const dayLabel = getDayHeaderLabel(d);
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDate = item.dateStr;
    }

    if (item.type === 'cellar') {
      html += renderShowCard(item.show, hideSkips, false, item.dateStr);
    } else if (item.type === 'stand') {
      html += renderStandShowCard(item.show);
    } else if (item.type === 'gotham') {
      const show = item.show;
      html += `
        <div class="show-card">
          <div class="show-header">
            <div><span class="show-time">${formatTime(show.time)}</span></div>
            <span class="show-name">${show.title}</span>
            <span class="show-venue">Gotham</span>
          </div>
          <div class="show-footer">
            ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
            <span class="fav-count"></span>
          </div>
        </div>`;
    } else {
      const evt = item.show;
      const evtSoldOut = !!evt.soldout;
      if (shouldHideShow(evtSoldOut)) return;
      // Build performer list for comedian chips — use performers string or fall back to title
      const evtPerformers = evt.performers
        ? evt.performers.split(',').map(p => p.split(' - ')[0].trim()).filter(Boolean)
        : [evt.title];
      // Seed performerImages into comedianPhotos so renderComedianChips can find them
      if (evt.performerImages) {
        Object.entries(evt.performerImages).forEach(([name, url]) => {
          if (!comedianPhotos[name]) comedianPhotos[name] = url;
        });
      }
      const hideSkipsBig = document.getElementById('hide-skips')?.checked;
      const evtChips = renderComedianChips(evtPerformers, hideSkipsBig, 'big');
      const cardClass = 'show-card' + (evtSoldOut ? ' sold-out' : '');
      const links = evt.ticketLinks || (evt.url ? [{ source: evt.source || 'tickets', url: evt.url }] : []);
      const preferred = links.find(l => l.source === 'seatgeek') || links[0];
      const ticketUrl = venueTicketUrl(evt.venue) || preferred?.url || evt.url;
      html += `
        <div class="${cardClass}" data-venue-source="big">
          <div class="show-header">
            <div><span class="show-time">${formatTime(evt.time)}</span></div>
            <span class="show-name">${evt.title}</span>
            <span class="show-venue">${cleanVenueName(evt.venue) || ''}</span>
          </div>
          <div class="show-lineup">${evtChips}</div>
          <div class="show-footer">
            ${ticketUrl ? `<a href="${ticketUrl}" target="_blank" class="reserve-btn${evtSoldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${evtSoldOut ? 'Sold Out' : 'Tickets'}</a>` : '<span></span>'}
            ${evtSoldOut ? hideSoldOutToggle(evtSoldOut) : '<span class="fav-count"></span>'}
          </div>
        </div>`;
    }
    } catch (e) { console.error('renderAllVenues card error:', e, item); }
  });

  html += '</div>';
  container.innerHTML = html;
}

function getNeighborhood(item) {
  if (item.type === 'cellar' || item.type === 'stand') return 'downtown';
  if (item.type === 'gotham') return 'midtown';
  const venue = (item.show.venue || '').toLowerCase();
  if (venue.includes('beacon') || venue.includes('apollo')) return 'uptown';
  if (venue.includes('gramercy theatre') || venue.includes('irving plaza')) return 'downtown';
  if (venue.includes('ny comedy club') || venue.includes('new york comedy club')) return 'downtown';
  // Default: Big Shows Midtown (MSG, Radio City, Town Hall, Sony Hall, City Winery, Gotham)
  return 'midtown';
}

function renderAllVenuesSourceFilter() {
  // Neighborhood (Downtown/Midtown/Uptown) now lives in the Filters dropdown
  // (#neighborhood-filter); see renderShows() for its show/hide + value sync.
  const container = document.getElementById('venue-filters');
  if (container) container.innerHTML = '';
}

function setNeighborhood(nb) {
  activeNeighborhood = nb;
  updateResetBtn();
  renderShows();
}

// ---- Responsive toolbar: keep it to <=3 rows. When the controls would spill
//      onto a 4th row, roll the secondary ones (Big Pics, sold-out, Sort) into
//      the Filters dropdown; the search + Filters buttons always stay visible. ----
const TOOLBAR_COLLAPSIBLE = ['big-pics-toggle', 'soldout-filter', 'sort-select'];

function _toolbarRowCount() {
  const rg = document.getElementById('toolbar-right-group');
  const items = [
    document.getElementById('open-settings'),
    document.getElementById('quick-mode-label'),
    ...(rg ? Array.from(rg.children) : []),
  ].filter(el => el && el.getClientRects().length);
  if (!items.length) return 1;
  // align-items:center means same-row items share a center; bucket centers ~rows.
  const centers = items
    .map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; })
    .sort((a, b) => a - b);
  let rows = 0, last = -1e9;
  for (const c of centers) { if (c - last > 18) { rows++; last = c; } }
  return rows || 1;
}

function reflowToolbar() {
  try {
    const rg = document.getElementById('toolbar-right-group');
    const fi = document.getElementById('filters-inline');
    const searchBtn = document.getElementById('search-btn');
    const filtersBtn = document.getElementById('filters-toggle');
    if (!rg || !fi || !searchBtn) return;
    const nodes = TOOLBAR_COLLAPSIBLE.map(id => document.getElementById(id)).filter(Boolean);
    if (!nodes.length) return;
    // 1) Expand: secondary controls back in the toolbar, in order, before search.
    nodes.forEach(n => { rg.insertBefore(n, searchBtn); n.classList.remove('rolled-up'); });
    // 2) Measure the expanded layout (sync read, no paint between moves -> no flicker).
    if (_toolbarRowCount() > 3) {
      // 3) Roll them into the Filters dropdown, preserving order at its front.
      const ref = fi.firstChild;
      nodes.forEach(n => { fi.insertBefore(n, ref); n.classList.add('rolled-up'); });
      filtersBtn?.classList.add('has-rolled-up');
    } else {
      filtersBtn?.classList.remove('has-rolled-up');
    }
  } catch (e) { /* on any measurement error, leave the toolbar untouched */ }
}
window.reflowToolbar = reflowToolbar;

let activeBigVenue = 'all';

function renderBigShowVenueFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'big-shows') return;
  const venueSet = [...bigShows.map(e => cleanVenueName(e.venue)), ...gothamShows.map(() => 'Gotham Comedy Club')].filter(Boolean);
  const venueCounts = {};
  venueSet.forEach(v => { venueCounts[v] = (venueCounts[v] || 0) + 1; });
  const venues = [...new Set(venueSet)].sort((a, b) => venueCounts[b] - venueCounts[a] || a.localeCompare(b));
  const allVenues = ['all', ...venues];
  container.innerHTML = allVenues.map(v => {
    const label = v === 'all' ? 'All Venues' : v;
    const cls = v === activeBigVenue ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setBigVenue('${v.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setBigVenue(v) {
  activeBigVenue = v;
  updateResetBtn();
  renderShows();
}

function renderBigShows(container) {
  container.classList.remove('picture-mode');
  renderBigShowVenueFilters();

  if (bigShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading big shows...</div>';
    return;
  }

  // Filter by selected date and venue
  let filtered = activeDate === 'all' || activeDate === 'calendar'
    ? (activeDate === 'calendar' ? bigShows.filter(e => calendarSelectedDates.has(e.date)) : bigShows)
    : bigShows.filter(e => e.date === activeDate);
  if (activeBigVenue !== 'all') {
    filtered = filtered.filter(e => cleanVenueName(e.venue) === activeBigVenue);
  }
  filtered = filtered.filter(e => !isShowPast(e.date, e.time));
  filtered = filtered.filter(e => showMatchesSearch(e, 'Big Show'));

  // Store SeatGeek performer images in global map
  filtered.forEach(evt => {
    if (evt.performerImages) {
      Object.entries(evt.performerImages).forEach(([name, url]) => {
        if (!comedianPhotos[name]) comedianPhotos[name] = url;
      });
    }
  });

  // Clean venue names before grouping
  filtered.forEach(evt => { evt.venue = cleanVenueName(evt.venue); });

  // Group by primary performer name — handles tour name variations, rescheduled suffixes, age tags
  const byPerformer = {};
  filtered.forEach(evt => {
    // Use first performer name as grouping key (strips tour names, "- Full Name" suffixes, etc.)
    const firstPerformer = (evt.performers || '').split(',')[0].trim().split(' - ')[0].trim();
    const cleanTitle = (evt.title || 'Unknown').replace(/\s*\(Rescheduled.*?\)/i, '').replace(/\s*\(Postponed.*?\)/i, '').replace(/\s*\(\d+\+\)/i, '').trim();
    let key = (firstPerformer || cleanTitle).toLowerCase();
    // Fuzzy merge: if no performer and title-based key doesn't match an existing group,
    // check if an existing group's performer words match the start of this title
    // Handles spelling variations like SG "Ruslan Bely" vs TM "RUSLAN BELIY STAND UP SHOW"
    if (!firstPerformer && !byPerformer[key]) {
      const titleWords = key.replace(/[^a-z\s]/g, '').trim().split(/\s+/);
      for (const [existingKey, existingData] of Object.entries(byPerformer)) {
        const perfWords = (existingData.performers || existingKey).toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(w => w.length >= 3);
        if (perfWords.length < 2) continue;
        const titleStart = titleWords.slice(0, perfWords.length + 2);
        const allMatch = perfWords.every(w => titleStart.some(tw => {
          if (tw === w) return true;
          const min = Math.min(tw.length, w.length);
          let shared = 0; for (let i = 0; i < min; i++) { if (tw[i] === w[i]) shared++; }
          return shared >= 3 && shared >= min - 1;
        }));
        if (allMatch) {
          key = existingKey;
          break;
        }
      }
    }
    // Pick best display title: prefer descriptive show names over redundant "Name - Name" patterns
    const titleScore = (t) => {
      const lower = t.toLowerCase();
      // Penalize "Name - Name" redundancy (e.g. "Modi - Modi Rosenfeld")
      if (/ - /.test(t) && lower.includes(firstPerformer.toLowerCase())) return 0;
      // Prefer titles with tour/show names (colon = "Name: Tour Name")
      if (/: /.test(t)) return 3;
      // Prefer titles with "with" (e.g. "Garden of Laughs with Ronny Chieng")
      if (/\bwith\b/i.test(t)) return 2;
      return 1;
    };
    if (!byPerformer[key]) {
      byPerformer[key] = { events: [], venue: evt.venue, performers: evt.performers, performerImages: evt.performerImages, displayTitle: cleanTitle };
    } else if (titleScore(cleanTitle) > titleScore(byPerformer[key].displayTitle)) {
      byPerformer[key].displayTitle = cleanTitle;
    }
    // Merge performerImages from all sources
    if (evt.performerImages) {
      Object.entries(evt.performerImages).forEach(([n, url]) => {
        if (!byPerformer[key].performerImages) byPerformer[key].performerImages = {};
        if (!byPerformer[key].performerImages[n]) byPerformer[key].performerImages[n] = url;
      });
    }
    byPerformer[key].events.push(evt);
  });

  // Sort groups by earliest show date
  const sortedGroups = Object.entries(byPerformer).sort((a, b) => {
    const aMin = a[1].events.reduce((m, e) => e.date < m ? e.date : m, '9999');
    const bMin = b[1].events.reduce((m, e) => e.date < m ? e.date : m, '9999');
    return aMin.localeCompare(bMin);
  });

  let html = '<div class="big-shows-section">';

  sortedGroups.forEach(([groupKey, data]) => {
    try {
    const title = data.displayTitle;
    const firstEvt = data.events[0];
    // Performer photo
    let photoUrl = '';
    if (data.performerImages) {
      // Find first non-bad performer image
      for (const url of Object.values(data.performerImages)) {
        if (url && !isBadPhotoUrl(url)) { photoUrl = url; break; }
      }
    }
    if (!photoUrl) {
      photoUrl = getPhotoForVenue(title, 'cellar') || localPhotoPath(title) || '';
      if (!photoUrl && data.performers) {
        for (const p of data.performers.split(', ')) {
          photoUrl = getPhotoForVenue(p, 'cellar') || localPhotoPath(p) || '';
          if (photoUrl) break;
        }
      }
    }
    const lookupName = data.performers ? data.performers.split(', ')[0] : title;
    if (!photoUrl && photoLookupCache[lookupName] && !isBadPhotoUrl(photoLookupCache[lookupName])) photoUrl = photoLookupCache[lookupName];
    if (!photoUrl && photoLookupCache[title] && !isBadPhotoUrl(photoLookupCache[title])) photoUrl = photoLookupCache[title];
    // Last resort: use event-level image (TM promotional poster)
    if (!photoUrl && data.events) {
      for (const evt of data.events) {
        if (evt.eventImage && !isBadPhotoUrl(evt.eventImage)) { photoUrl = evt.eventImage; break; }
      }
    }
    const needsLookup = !photoUrl;
    const photoId = needsLookup ? `photo-lookup-${title.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const photoHtml = photoUrl
      ? `<img src="${photoUrl}" alt="${title}" class="big-show-photo" style="cursor:zoom-in" onerror="this.style.display='none'" onclick="event.stopPropagation(); if(this.src)_dirOpenPhoto(this.src, this.alt)">`
      : `<img id="${photoId}" alt="${title}" class="big-show-photo" style="display:none;cursor:zoom-in" onerror="this.style.display='none'" onclick="event.stopPropagation(); if(this.src)_dirOpenPhoto(this.src, this.alt)" data-lookup-name="${lookupName.replace(/"/g, '&quot;')}" data-lookup-title="${title.replace(/"/g, '&quot;')}">`;

    // Date boxes — sorted by date, deduplicated by date+time (merges SG/TM duplicates)
    // Also drop time-less entries when another entry on the same date has a time
    const datesWithTime = new Set(data.events.filter(e => e.time).map(e => e.date));
    const seen = new Set();
    const sortedEvents = data.events
      .filter(evt => evt.time || !datesWithTime.has(evt.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
      .filter(evt => {
        const key = evt.date + '|' + (evt.time || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    // Apply sold-out filter (hide / only / all)
    const visibleEvents = sortedEvents.filter(evt => !shouldHideShow(!!evt.soldout));
    if (visibleEvents.length === 0) return;
    const allSoldOut = visibleEvents.every(evt => evt.soldout);
    const dateBoxes = visibleEvents.map(evt => {
      const d = new Date(evt.date + 'T12:00:00');
      const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const shortDay = d.toLocaleDateString('en-US', { weekday: 'short' });
      const timeStr = evt.time || '';
      const priceStr = evt.price ? `$${evt.price}` : '';
      const evtSoldOut = !!evt.soldout;
      const links = evt.ticketLinks || (evt.url ? [{ source: evt.source || 'tickets', url: evt.url }] : []);

      // Sold out: grey button with white text, no links
      if (evtSoldOut) {
        return `<div class="bdb-wrap"><span class="big-date-box sold-out"><span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span><span class="bdb-sold-out">SOLD OUT</span></span></div>`;
      }

      const dateContent = `<span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span>${priceStr ? `<span class="bdb-price">${priceStr}</span>` : ''}`;

      // TODO: Multi-source SG/TM badges — revisit later
      // if (links.length > 1) {
      //   const sourceButtons = links.map(l =>
      //     `<a href="${l.url}" target="_blank" class="bdb-source-link" title="${l.source === 'seatgeek' ? 'SeatGeek' : 'Ticketmaster'}" onclick="trackReserve(this)">${l.source === 'seatgeek' ? 'SG' : 'TM'}</a>`
      //   ).join('');
      //   return `<div class="bdb-wrap"><a href="${links[0].url}" target="_blank" class="big-date-box" onclick="trackReserve(this)">${dateContent}</a><span class="bdb-sources">${sourceButtons}</span></div>`;
      // }

      // Single link per date box (uses first available source)
      const singleUrl = venueTicketUrl(data.venue) || links[0]?.url || evt.url;
      return singleUrl
        ? `<div class="bdb-wrap"><a href="${singleUrl}" target="_blank" class="big-date-box" onclick="trackReserve(this)">${dateContent}</a></div>`
        : `<div class="bdb-wrap"><span class="big-date-box">${dateContent}</span></div>`;
    }).join('');

    html += `
      <div class="big-show-card${allSoldOut ? ' sold-out' : ''}">
        <div class="big-show-info">
          ${photoHtml}
          <div class="big-show-details">
            <div class="big-show-title" onclick="showTitlePopup(this)" title="${title.replace(/"/g, '&quot;')}">${title}</div>
            <div class="big-show-venue">${cleanVenueName(data.venue)}</div>
            <div class="big-date-boxes">${dateBoxes}</div>
          </div>
        </div>
      </div>`;
    } catch (e) { console.error('renderBigShows card error:', e, title); }
  });

  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();

  // Auto-resolve missing photos via server-side scrape
  container.querySelectorAll('img[data-lookup-name]').forEach(img => {
    const name = img.dataset.lookupName;
    const title = img.dataset.lookupTitle;
    autoResolvePhoto(name, img);
    if (name !== title) autoResolvePhoto(title, img);
  });
}

function renderVenueFilters(shows) {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'cellar') { container.innerHTML = ''; return; }
  if (!shows || shows.length === 0) { container.innerHTML = ''; return; }

  // Always show the 3 main venues
  const mainVenues = ['all', 'MacDougal Street', 'Village Underground', 'Fat Black Pussycat'];
  container.innerHTML = mainVenues.map(v => {
    const label = v === 'all' ? 'All Venues' : v;
    const cls = v === activeVenue ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setVenue('${v.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setVenue(v) {
  activeVenue = v;
  updateResetBtn();
  renderShows();
}

function renderBottomTabs() {

  let nav = document.getElementById('bottom-tabs');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'bottom-tabs';
    nav.className = 'day-tabs bottom-tabs';
    document.querySelector('.shows-container').after(nav);
  }
  nav.innerHTML = '';
  // Full Schedule first
  const allTab = document.createElement('button');
  allTab.className = 'day-tab' + (activeDate === 'all' ? ' active' : '');
  allTab.innerHTML = `<span class="tab-day">Full</span><span class="tab-date">Schedule</span>`;
  allTab.addEventListener('click', () => jumpToDay('all'));
  nav.appendChild(allTab);

  if (activeSource === 'the-stand') {
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `
        <span class="tab-day">${getDayName(d)}</span>
        <span class="tab-date">${getDateLabel(d)}</span>
      `;
      tab.addEventListener('click', () => jumpToDay(dateStr));
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'big-shows') {
    const bigDates = [...new Set(bigShows.map(e => e.date))].sort();
    bigDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>`;
      tab.addEventListener('click', () => jumpToDay(dateStr));
      nav.appendChild(tab);
    });
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    const hasCellar = shows && shows.length > 0;
    let noLineup;
    if (activeSource === 'all') {
      noLineup = !hasCellar && !standShows.some(s => s.date === dateStr) && !nyccShows.some(s => s.date === dateStr) && !gothamShows.some(s => s.date === dateStr) && !bigShows.some(e => e.date === dateStr);
    } else {
      noLineup = !hasCellar;
    }
    const tab = document.createElement('button');
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
    `;
    tab.addEventListener('click', () => jumpToDay(dateStr));
    nav.appendChild(tab);
  });
}

// Click a comedian chip
function handleComedianClick(el) {
  // Find the comedian element (might have clicked a child)
  const comedianEl = el.dataset.name ? el : el.closest('[data-name]');
  if (!comedianEl) return;
  const name = comedianEl.dataset.name;
  const quickMode = document.getElementById('quick-mode')?.checked;

  // Quick fav/skip mode: cycle
  if (quickMode) {
    cycleComedian(name);
    renderTabs();
    renderShows();
    return;
  }

  // Default: expand bio panel
  const container = el.closest('.show-lineup') || el.parentElement;
  const existing = container.querySelector(`.comedian-expanded[data-for="${name}"]`);

  if (existing) {
    existing.remove();
    return;
  }
  container.querySelectorAll('.comedian-expanded').forEach(e => e.remove());

  // Determine venue source from show card context
  const showCard = el.closest('.show-card');
  let panelVenueSource = 'cellar'; // default
  // Check data attribute first (most reliable)
  if (showCard?.dataset?.venueSource) {
    panelVenueSource = showCard.dataset.venueSource;
  } else if (activeSource === 'the-stand') {
    panelVenueSource = 'stand';
  } else if (activeSource === 'all' && showCard) {
    const venueEl = showCard.querySelector('.show-venue');
    const showNameEl = showCard.querySelector('.show-name');
    const venueText = venueEl?.textContent?.toLowerCase() || '';
    const showName = showNameEl?.textContent?.toLowerCase() || '';
    if (venueText.includes('stand') || showName.includes('stand')) panelVenueSource = 'stand';
    else if (venueText.includes('gotham')) panelVenueSource = 'gotham';
    else if (venueText.includes('comedy club')) panelVenueSource = 'nycc';
  }

  const fullBio = getBioForVenue(name, panelVenueSource);
  const photo = getPhotoForVenue(name, panelVenueSource);
  const prefs = loadPrefs();
  const isFavd = prefs.faves.includes(name);
  const isSkipd = prefs.skips.includes(name);
  const isLiked = prefs.likes.includes(name);
  const isNeutral = !isFavd && !isSkipd && !isLiked;
  const esc = name.replace(/'/g, "\\'");
  const alerted = isAlerted(name);

  const dbEntry = comedianDB.find(c => c.name === name);
  const dbPhoto = photo; // already venue-aware via getPhotoForVenue
  // Format venue names: exclude current source AND only show venues we actively have data for
  const venueNameMap = {
    'the_stand': 'The Stand',
    'comedy_cellar': 'Comedy Cellar',
    'nycc': 'NY Comedy Club',
    'ny_comedy_club': 'NY Comedy Club',
  };
  // Only show "Also at" if comedian has a live upcoming show at that venue
  const standComedianNames = new Set();
  standShows.forEach(show => show.comedians.forEach(n => standComedianNames.add(n)));
  const cellarComedianNames = new Set();
  Object.values(allData).forEach(dayShows => { if (dayShows) dayShows.forEach(show => show.comedians.forEach(n => cellarComedianNames.add(n))); });
  const liveVenueCheck = {
    'comedy_cellar': (n) => cellarComedianNames.has(n),
    'the_stand': (n) => standComedianNames.has(n),
  };
  // Exclude the venue the user is currently browsing — no "Also at: Comedy Cellar" on the Cellar tab
  const excludeVenues = new Set();
  if (activeSource === 'cellar') excludeVenues.add('comedy_cellar');
  else if (activeSource === 'the-stand') excludeVenues.add('the_stand');
  else if (activeSource === 'all') {
    // In "All Venues" mode, exclude any venue the comedian actually appears in
    if (cellarComedianNames.has(name)) excludeVenues.add('comedy_cellar');
    if (standComedianNames.has(name)) excludeVenues.add('the_stand');
  }
  const venues = dbEntry?.venues
    ?.filter(v => !excludeVenues.has(v) && liveVenueCheck[v]?.(name))
    ?.map(v => venueNameMap[v] || v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    ?.join(', ') || '';

  const panel = document.createElement('div');
  panel.className = 'comedian-expanded open';
  panel.dataset.for = name;
  if (fullBio) panel.dataset.fullBio = fullBio;
  panel.innerHTML = `
    ${dbPhoto ? `<img src="${dbPhoto}" alt="${name}" class="exp-photo" onclick="event.stopPropagation();_dirOpenPhoto('${dbPhoto.replace(/'/g, "\\'")}','${esc}')">` : ''}
    <div class="exp-info">
      <div class="exp-name">${name}</div>
      ${fullBio ? (() => {
        const longMode = document.getElementById('expand-long-bios')?.checked;
        const MAX = 300;
        if (longMode || fullBio.length <= MAX) return `<div class="exp-tagline">${fullBio}</div>`;
        const truncated = fullBio.substring(0, MAX).replace(/\s+\S*$/, '') + '...';
        return `<div class="exp-tagline exp-bio-truncated">${truncated} <a href="#" class="bio-more-link" onclick="event.preventDefault();expandBioInPanel(this);" style="color:var(--text-dim);font-weight:500;">more</a></div>`;
      })() : ''}
      ${venues ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Also at: ${venues}</div>` : ''}
      <div class="exp-actions">
        <button class="exp-btn ${isFavd ? 'is-fav' : ''}" onclick="setPref('${esc}','${isFavd ? 'neutral' : 'fav'}')">
          ${isFavd ? `${ICON.starFilled} Favorited` : `${ICON.starOutline} Favorite`}
        </button>
        <button class="exp-btn ${isNeutral ? 'is-neutral' : ''}" onclick="setPref('${esc}','neutral')">
          ${isNeutral ? '● Neutral' : '○ Neutral'}
        </button>
        <button class="exp-btn ${isSkipd ? 'is-skip' : ''}" onclick="setPref('${esc}','${isSkipd ? 'neutral' : 'skip'}')">
          ${isSkipd ? `${ICON.x} Skipped` : `${ICON.minus} Skip`}
        </button>
        <button class="exp-btn" onclick="filterByComedian('${esc}')">
          ${ICON.search} Filter shows
        </button>
        <button class="exp-btn exp-btn-bell ${alerted ? 'is-alert' : ''}" onclick="toggleAlertBtn('${esc}', this)" title="${alerted ? 'Turn off email alerts' : 'Email me when this comedian is booked'}" aria-label="Notify me">
          ${ICON.bell}
        </button>
      </div>
    </div>
  `;
  // Append at end of lineup (before reserve/footer), not after clicked card
  container.appendChild(panel);
}

function expandBioInPanel(link) {
  const panel = link.closest('.comedian-expanded');
  if (!panel) return;
  const tagline = panel.querySelector('.exp-tagline');
  if (tagline && panel.dataset.fullBio) {
    tagline.textContent = panel.dataset.fullBio;
    tagline.classList.remove('exp-bio-truncated');
  }
}

function toggleAlertBtn(name, btn) {
  // Prompt for email on first alert if not set
  if (!isAlerted(name) && !getAlertEmail()) {
    const email = prompt('Enter your email to get notified when this comedian is in an upcoming lineup:');
    if (!email || !email.includes('@')) return;
    setAlertEmail(email.trim());
  }
  toggleAlert(name);
  const alerted = isAlerted(name);
  btn.classList.toggle('is-alert', alerted);
  btn.title = alerted ? 'Turn off email alerts' : 'Email me when this comedian is booked';
}

// Global filter state for comedian filtering
let activeComedianFilter = null;
// Free-text search across comedians, show names, and venues (set from the toolbar search popup)
let activeSearchQuery = '';

function filterByComedian(name) {
  if (activeComedianFilter === name) {
    // Toggle off — clear filter
    activeComedianFilter = null;
  } else {
    activeComedianFilter = name;
    activeSearchQuery = ''; // exact-comedian filter and free-text search are mutually exclusive
  }
  // Collapse expanded panel
  document.querySelectorAll('.expanded-panel').forEach(p => p.remove());
  renderShows();
  scrollToTop();
}

function setSearchQuery(q) {
  activeSearchQuery = (q || '').toLowerCase().trim();
  activeComedianFilter = null;
  document.querySelectorAll('.expanded-panel').forEach(p => p.remove());
  renderShows();
  scrollToTop();
}

function clearSearch() {
  activeSearchQuery = '';
  renderShows();
}

// True if a show matches the active free-text search. venueLabel is the human venue
// name for the show's source so queries like "cellar" or "gotham" match.
function showMatchesSearch(show, venueLabel) {
  if (!activeSearchQuery) return true;
  if (!show) return false;
  const parts = [venueLabel];
  if (show.comedians) parts.push(...show.comedians);
  if (show.title) parts.push(show.title);
  if (show.venue) parts.push(show.venue);
  if (show.room) parts.push(show.room);
  if (show.performers) parts.push(show.performers);
  if (show.description) parts.push(show.description);
  return parts.filter(Boolean).join(' | ').toLowerCase().includes(activeSearchQuery);
}

const VENUE_LABEL_BY_TYPE = { cellar: 'Comedy Cellar', stand: 'The Stand', gotham: 'Gotham Comedy Club', big: 'Big Show', nycc: 'NY Comedy Club' };

function setPref(name, type) {
  const prefs = loadPrefs();
  prefs.faves = prefs.faves.filter(n => n !== name);
  prefs.skips = prefs.skips.filter(n => n !== name);
  prefs.likes = prefs.likes.filter(n => n !== name);
  if (type === 'fav') prefs.faves.push(name);
  else if (type === 'like') prefs.likes.push(name);
  else if (type === 'skip') prefs.skips.push(name);
  // 'neutral' = just remove from all (already done above)
  savePrefs(prefs);
  renderTabs();
  renderShows();
}

// ---- Comedian Directory (archive + alert browse) ----
window._dirSearch = window._dirSearch || '';
window._dirOnlyFaves = window._dirOnlyFaves || false;
window._dirOnlyLive = window._dirOnlyLive || false;
window._dirAlphaMode = window._dirAlphaMode || false;
window._dirShowCount = window._dirShowCount || 60;

// Hide-empty filter: previously hid ~124 orphans with no venue/bio/photo,
// but per user feedback (2026-05-18) these include real emerging comedians
// with blank venue profiles. Now we keep everyone — user audits junk
// entries via data/comedian-review.csv and deletes manually.
//
// Entries flagged not_a_person:true (set manually) ARE hidden — escape
// hatch for clearly non-person entries like event titles.
function _dirIsEmpty(c) {
  return !!c.not_a_person;
}

function _dirLiveSet() {
  const live = new Set();
  Object.values(allData).forEach(day => { if (day) day.forEach(s => s.comedians.forEach(n => live.add(n))); });
  standShows.forEach(s => s.comedians.forEach(n => live.add(n)));
  if (typeof gothamShows !== 'undefined') gothamShows.forEach(s => (s.comedians || []).forEach(n => live.add(n)));
  if (typeof bigShows !== 'undefined') bigShows.forEach(e => {
    if (e.title) live.add(e.title.trim());
    if (e.performers) e.performers.split(/,\s*/).forEach(n => { if (n.trim()) live.add(n.trim()); });
  });
  return live;
}

// Section bucketing for the comedian directory.
// One divider per tier (fav / live / alpha) — NOT per letter. The letter is shown inside
// the sticky header via a span that gets updated by _dirUpdateStickyLetters as you scroll.
// Faves header has no letter slot per Jacob's spec.
function _dirSectionFor(c, prefs, liveSet) {
  if (window._dirAlphaMode) {
    return { key: 'alpha', label: '<span class="dir-letter" data-tier="alpha">A</span>' };
  }
  if (prefs.faves.includes(c.name)) return { key: 'fav', label: 'Your Favorites' };
  if (liveSet.has(c.name)) return { key: 'live', label: 'Booked This Week · <span class="dir-letter" data-tier="live">A</span>' };
  return { key: 'alpha', label: 'Alphabetical · <span class="dir-letter" data-tier="alpha">A</span>' };
}

// Tag each card with its tier + first-letter so the scroll listener can quickly find the
// topmost-visible card per tier and update the sticky header's letter slot.
function _dirTierFor(c, prefs, liveSet) {
  // Deceased + featured render in their own sections — give them dedicated tiers
  // so their sticky headers get a scrolling letter slot like the others.
  if (c.deceased) return 'rip';
  if (c.featured) return 'featured';
  if (window._dirAlphaMode) return 'alpha';
  if (prefs.faves.includes(c.name)) return 'fav';
  if (liveSet.has(c.name)) return 'live';
  return 'alpha';
}

function _dirLetterFor(c) {
  const ch = (c.name[0] || '#').toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

// Render a slice of cards with sticky section headers inserted at section boundaries.
// `prevSectionKey` lets the infinite-scroll path resume without duplicating a header.
function _dirCardsWithSections(slice, prefs, liveSet, prevSectionKey) {
  let last = prevSectionKey || null;
  let html = '';
  for (const c of slice) {
    const s = _dirSectionFor(c, prefs, liveSet);
    if (s.key !== last) {
      html += `<div class="dir-section-header" data-section="${s.key}">${s.label}</div>`;
      last = s.key;
    }
    html += _dirCardHTML(c, prefs, liveSet);
  }
  // Stash the last-emitted section so infinite scroll can pick up where this slice ended.
  window._dirLastSection = last;
  return html;
}

function renderComedianDirectory(container) {
  const prefs = loadPrefs();
  const liveSet = _dirLiveSet();
  const search = (window._dirSearch || '').toLowerCase().trim();
  const onlyFaves = window._dirOnlyFaves;
  const onlyLive = window._dirOnlyLive;
  const onlyFeatured = window._dirOnlyFeatured;
  const alphaOnly = window._dirAlphaMode;

  // Filter
  let list = (comedianDB || []).slice().filter(c => !_dirIsEmpty(c));
  if (search) list = list.filter(c => c.name.toLowerCase().includes(search));
  if (onlyFaves) list = list.filter(c => prefs.faves.includes(c.name));
  if (onlyLive) list = list.filter(c => liveSet.has(c.name));

  // Split deceased AND featured (touring legends) into their own sections
  const deceasedList = list.filter(c => c.deceased).sort((a, b) => a.name.localeCompare(b.name));
  const featuredList = list.filter(c => c.featured && !c.deceased).sort((a, b) => a.name.localeCompare(b.name));
  list = list.filter(c => !c.deceased && !c.featured);

  // "Jump-to-section" filter: isolate Touring Legends by emptying everything else
  // (the main living grid + the In Memoriam list) so only that section renders.
  if (onlyFeatured) { list = []; deceasedList.length = 0; }

  // Sort: faves first, then live, then alphabetical
  const alphaMode = !!window._dirAlphaMode;
  list.sort((a, b) => {
    if (!alphaMode) {
      const af = prefs.faves.includes(a.name) ? 0 : 1;
      const bf = prefs.faves.includes(b.name) ? 0 : 1;
      if (af !== bf) return af - bf;
      const al = liveSet.has(a.name) ? 0 : 1;
      const bl = liveSet.has(b.name) ? 0 : 1;
      if (al !== bl) return al - bl;
    }
    return a.name.localeCompare(b.name);
  });

  const total = list.length + deceasedList.length + featuredList.length;
  const livingShown = Math.min(window._dirShowCount, list.length);
  const visible = list.slice(0, livingShown);
  // Featured + RIP sections always visible — not gated on scrolling.
  const showFeatured = !onlyFaves && !onlyLive && featuredList.length > 0;
  const showRip = !onlyFaves && !onlyLive && deceasedList.length > 0;

  const scrollY = window.scrollY;

  container.innerHTML = `
    <div class="comedian-directory">
      <div class="dir-controls">
        <input type="text" id="dir-search" class="dir-search" placeholder="Search ${total} comedians..." value="${(window._dirSearch || '').replace(/"/g, '&quot;')}">
        <div class="dir-toggles">
          <label class="dir-toggle"><input type="checkbox" id="dir-only-faves" ${onlyFaves ? 'checked' : ''}><span>My faves only</span></label>
          <label class="dir-toggle"><input type="checkbox" id="dir-only-live" ${onlyLive ? 'checked' : ''}><span>Booked this week</span></label>
          <label class="dir-toggle"><input type="checkbox" id="dir-alpha-mode" ${alphaOnly ? 'checked' : ''}><span>Alphabetical</span></label>
          <label class="dir-toggle"><input type="checkbox" id="dir-only-featured" ${onlyFeatured ? 'checked' : ''}><span>Touring legends</span></label>
        </div>
        <div class="dir-count">${total === 0 ? 'No comedians match' : `${livingShown === list.length ? total : livingShown + ' of ' + total} comedian${total === 1 ? '' : 's'}`}</div>
      </div>
      <div class="dir-grid">
        ${_dirCardsWithSections(visible, prefs, liveSet)}
      </div>
      ${livingShown < list.length ? `<div id="dir-sentinel" class="dir-sentinel" aria-hidden="true"></div>` : ''}
      ${showFeatured ? `
        <div class="dir-featured-section">
          <h3 class="dir-featured-heading">Touring Legends · <span class="dir-letter" data-tier="featured">A</span></h3>
          <div class="dir-grid">
            ${featuredList.map(c => _dirCardHTML(c, prefs, liveSet)).join('')}
          </div>
        </div>
      ` : ''}
      ${showRip ? `
        <div class="dir-rip-section">
          <h3 class="dir-rip-heading">In Memoriam · <span class="dir-letter" data-tier="rip">A</span></h3>
          <div class="dir-grid">
            ${deceasedList.map(c => _dirCardHTML(c, prefs, liveSet)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Restore scroll for in-place updates (e.g. after fave toggle)
  if (scrollY > 0) window.scrollTo(0, scrollY);

  // Track the height of .dir-controls so section headers can stick directly below it.
  // Without this, sticky letter dividers would slide *under* the controls bar.
  const ctrls = document.querySelector('.dir-controls');
  if (ctrls) {
    const setVar = () => document.documentElement.style.setProperty('--dir-ctrl-h', ctrls.offsetHeight + 'px');
    setVar();
    if (window._dirCtrlObserver) window._dirCtrlObserver.disconnect();
    window._dirCtrlObserver = new ResizeObserver(setVar);
    window._dirCtrlObserver.observe(ctrls);
  }

  // Wire controls
  const searchInput = document.getElementById('dir-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      window._dirSearch = e.target.value;
      window._dirShowCount = 60;
      _dirRerenderDebounced();
    });
    if (document.activeElement !== searchInput && search) {
      // keep focus if user was typing — but only if they're already focused; don't steal focus
    }
  }
  const onlyFavesCb = document.getElementById('dir-only-faves');
  if (onlyFavesCb) onlyFavesCb.addEventListener('change', (e) => {
    window._dirOnlyFaves = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  const onlyLiveCb = document.getElementById('dir-only-live');
  if (onlyLiveCb) onlyLiveCb.addEventListener('change', (e) => {
    window._dirOnlyLive = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  const onlyFeaturedCb = document.getElementById('dir-only-featured');
  if (onlyFeaturedCb) onlyFeaturedCb.addEventListener('change', (e) => {
    window._dirOnlyFeatured = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  const alphaModeCb = document.getElementById('dir-alpha-mode');
  if (alphaModeCb) alphaModeCb.addEventListener('change', (e) => {
    window._dirAlphaMode = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  _dirAttachInfiniteScroll();
  _dirAttachStickyLetterUpdater();
}

// Updates the letter span inside each sticky tier header so the visible header always shows
// the letter of the topmost card currently in that tier. Throttled via rAF; scan stops as
// soon as we've resolved a letter for every tier currently in the DOM.
function _dirUpdateStickyLetters() {
  const headers = document.querySelectorAll('.dir-section-header');
  if (!headers.length) return;
  const ctrls = document.querySelector('.dir-controls');
  const threshold = ctrls ? ctrls.getBoundingClientRect().bottom : 0;
  const headerH = headers[0].getBoundingClientRect().height || 0;
  // We want the letter of the first card whose top is below the sticky header — i.e., the
  // topmost not-yet-scrolled-past card. Threshold = bottom of controls + sticky header height.
  const cutoff = threshold + headerH;
  const cards = document.querySelectorAll('.dir-card');
  const currentByTier = {};
  for (const card of cards) {
    const tier = card.dataset.tier;
    if (!tier || currentByTier[tier]) continue;
    const rect = card.getBoundingClientRect();
    if (rect.bottom < cutoff) continue;
    currentByTier[tier] = card.dataset.letter || '';
  }
  document.querySelectorAll('.dir-letter[data-tier]').forEach(span => {
    const next = currentByTier[span.dataset.tier];
    if (next && span.textContent !== next) span.textContent = next;
  });
}

function _dirAttachStickyLetterUpdater() {
  if (window._dirStickyAttached) {
    _dirUpdateStickyLetters();
    return;
  }
  let queued = false;
  const handler = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; _dirUpdateStickyLetters(); });
  };
  window.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('resize', handler, { passive: true });
  window._dirStickyAttached = true;
  _dirUpdateStickyLetters();
}

// Auto-load more comedian cards when the sentinel scrolls into view.
// Avoids a full renderShows() call to preserve scroll position.
function _dirAttachInfiniteScroll() {
  const sentinel = document.getElementById('dir-sentinel');
  if (!sentinel) return;
  if (window._dirObserver) window._dirObserver.disconnect();
  window._dirObserver = new IntersectionObserver((entries) => {
    if (!entries.some(e => e.isIntersecting)) return;
    const grid = document.querySelectorAll('.dir-grid')[0];
    if (!grid) return;
    const prefs = loadPrefs();
    const liveSet = _dirLiveSet();
    const search = (window._dirSearch || '').toLowerCase().trim();
    let list = (comedianDB || []).slice().filter(c => !_dirIsEmpty(c));
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search));
    if (window._dirOnlyFaves) list = list.filter(c => prefs.faves.includes(c.name));
    if (window._dirOnlyLive) list = list.filter(c => liveSet.has(c.name));
    list = list.filter(c => !c.deceased && !c.featured);
    const alphaMode = !!window._dirAlphaMode;
    list.sort((a, b) => {
      if (!alphaMode) {
        const af = prefs.faves.includes(a.name) ? 0 : 1;
        const bf = prefs.faves.includes(b.name) ? 0 : 1;
        if (af !== bf) return af - bf;
        const al = liveSet.has(a.name) ? 0 : 1;
        const bl = liveSet.has(b.name) ? 0 : 1;
        if (al !== bl) return al - bl;
      }
      return a.name.localeCompare(b.name);
    });
    const prev = window._dirShowCount;
    const next = Math.min(prev + 60, list.length);
    if (next <= prev) return;
    const slice = list.slice(prev, next);
    grid.insertAdjacentHTML('beforeend', _dirCardsWithSections(slice, prefs, liveSet, window._dirLastSection));
    window._dirShowCount = next;
    const countEl = document.querySelector('.dir-count');
    const deceasedCount = (comedianDB || []).filter(c => c.deceased).length;
    const featuredCount = (comedianDB || []).filter(c => c.featured && !c.deceased).length;
    const total = list.length + deceasedCount + featuredCount;
    if (countEl) countEl.textContent = total === 0 ? 'No comedians match' : `${next === list.length ? total : next + ' of ' + total} comedian${total === 1 ? '' : 's'}`;
    if (next >= list.length) {
      window._dirObserver.disconnect();
      sentinel.remove();
    }
    _dirUpdateStickyLetters();
  }, { rootMargin: '600px 0px' });
  window._dirObserver.observe(sentinel);
}

let _dirSearchTimer = null;
function _dirRerenderDebounced() {
  clearTimeout(_dirSearchTimer);
  _dirSearchTimer = setTimeout(() => {
    const grid = document.querySelector('.dir-grid');
    const countEl = document.querySelector('.dir-count');
    const loadMore = document.getElementById('dir-load-more');
    if (!grid) { renderShows(); return; }
    const prefs = loadPrefs();
    const liveSet = _dirLiveSet();
    const search = (window._dirSearch || '').toLowerCase().trim();
    let list = (comedianDB || []).slice().filter(c => !_dirIsEmpty(c));
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search));
    if (window._dirOnlyFaves) list = list.filter(c => prefs.faves.includes(c.name));
    if (window._dirOnlyLive) list = list.filter(c => liveSet.has(c.name));
    list = list.filter(c => !c.deceased && !c.featured); // RIP + Touring Legends sections are static between renders
    const alphaMode = !!window._dirAlphaMode;
    list.sort((a, b) => {
      if (!alphaMode) {
        const af = prefs.faves.includes(a.name) ? 0 : 1;
        const bf = prefs.faves.includes(b.name) ? 0 : 1;
        if (af !== bf) return af - bf;
        const al = liveSet.has(a.name) ? 0 : 1;
        const bl = liveSet.has(b.name) ? 0 : 1;
        if (al !== bl) return al - bl;
      }
      return a.name.localeCompare(b.name);
    });
    const livingShown = Math.min(window._dirShowCount, list.length);
    const visible = list.slice(0, livingShown);
    // Keep this update scoped to the LIVING grid (first .dir-grid). RIP grid is below.
    window._dirLastSection = null;
    grid.innerHTML = _dirCardsWithSections(visible, prefs, liveSet);
    const deceasedCount = (comedianDB || []).filter(c => c.deceased).length;
    const featuredCount = (comedianDB || []).filter(c => c.featured && !c.deceased).length;
    const total = list.length + deceasedCount + featuredCount;
    if (countEl) countEl.textContent = total === 0 ? 'No comedians match' : `${livingShown === list.length ? total : livingShown + ' of ' + total} comedian${total === 1 ? '' : 's'}`;
    // Re-attach infinite-scroll sentinel after a debounced filter change.
    let sentinel = document.getElementById('dir-sentinel');
    if (livingShown < list.length) {
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'dir-sentinel';
        sentinel.className = 'dir-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        grid.parentNode.insertBefore(sentinel, grid.nextSibling);
      }
      _dirAttachInfiniteScroll();
    } else if (sentinel) {
      if (window._dirObserver) window._dirObserver.disconnect();
      sentinel.remove();
    }
    if (loadMore) {
      if (livingShown < list.length) {
        loadMore.textContent = `Show more (${list.length - livingShown} left)`;
        loadMore.style.display = '';
      } else {
        loadMore.style.display = 'none';
      }
    }
    _dirUpdateStickyLetters();
  }, 120);
}

function _dirCardHTML(c, prefs, liveSet) {
  const name = c.name;
  const esc = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const isFavd = prefs.faves.includes(name);
  const isSkipd = prefs.skips.includes(name);
  const alerted = (typeof isAlerted === 'function') ? isAlerted(name) : false;
  const isLive = liveSet.has(name);
  const isDeceased = !!c.deceased;
  // Photo: prefer prebaked local, then DB venue photos, then Wikipedia thumbnail
  let photo = (typeof getPhotoForVenue === 'function') ? getPhotoForVenue(name, '') : (c.photo_stand || c.photo_nycc || '');
  if (!photo && c.photo_wiki) photo = c.photo_wiki;
  const bio = (typeof getBioForVenue === 'function') ? getBioForVenue(name, '') : (c.bio || c.bio_wiki || '');
  // Three-stage bio: card-short (140) → paragraph (400) → full (entire stored bio).
  // - card-short to paragraph: click anywhere on the bio (whole div is the trigger)
  // - paragraph to full: click the "..." trigger at the end (only if there's more)
  // - any expanded state to card-short: click the paragraph text body
  const _bio = bio || '';
  const SHORT_LEN = 140;
  const MED_LEN = 400;
  const isLong = _bio.length > SHORT_LEN;
  const hasMore = _bio.length > MED_LEN;
  const bioShortText = isLong ? _bio.substring(0, SHORT_LEN).replace(/\s+\S*$/, '') : _bio;
  const bioMedText = hasMore ? _bio.substring(0, MED_LEN).replace(/\s+\S*$/, '') : _bio;
  const bioAttr = isLong ? _bio.replace(/"/g, '&quot;') : '';
  const bioShortAttr = isLong ? bioShortText.replace(/"/g, '&quot;') : '';
  const bioMedAttr = isLong ? bioMedText.replace(/"/g, '&quot;') : '';
  const tier = _dirTierFor(c, prefs, liveSet);
  const letter = _dirLetterFor(c);
  return `
    <div class="dir-card ${isFavd ? 'is-fav' : ''} ${isSkipd ? 'is-skip' : ''} ${isDeceased ? 'deceased' : ''} ${c.featured ? 'featured' : ''}" data-tier="${tier}" data-letter="${letter}">
      <div class="dir-card-photo"${photo ? ` onclick="_dirOpenPhoto('${photo.replace(/'/g, "\\'")}','${esc}')"` : ''}><div class="dir-photo-placeholder">${ICON.mic}</div>${photo ? `<img src="${photo}" alt="${name}" loading="lazy" onerror="this.style.display='none'">` : ''}</div>
      <div class="dir-card-body">
        <div class="dir-card-name">${name}${isLive ? ' <span class="dir-live-dot" title="Booked in upcoming lineup">●</span>' : ''}</div>
        ${bio ? (isLong
          ? `<div class="dir-card-bio truncated" data-full="${bioAttr}" data-short="${bioShortAttr}" data-medium="${bioMedAttr}" data-has-more="${hasMore ? '1' : '0'}" onclick="_dirBioClick(event, this)" title="Read more">${bioShortText}<span class="bio-more">…</span></div>`
          : `<div class="dir-card-bio">${bioShortText}</div>`) : ''}
        ${isDeceased ? '' : `<div class="dir-card-actions">
          <button class="dir-btn ${isFavd ? 'is-fav' : ''}" onclick="setPref('${esc}','${isFavd ? 'neutral' : 'fav'}')" title="${isFavd ? 'Remove favorite' : 'Favorite'}">${isFavd ? ICON.starFilled : ICON.starOutline}</button>
          <button class="dir-btn ${isSkipd ? 'is-skip' : ''}" onclick="setPref('${esc}','${isSkipd ? 'neutral' : 'skip'}')" title="${isSkipd ? 'Un-skip' : 'Skip'}">${isSkipd ? ICON.x : ICON.minus}</button>
          <button class="dir-btn ${alerted ? 'is-alert' : ''}" onclick="toggleAlertBtn('${esc}', this)" title="${alerted ? 'Turn off email alerts' : 'Email me when booked'}">${ICON.bell}</button>
        </div>`}
      </div>
    </div>
  `;
}

// Three-stage bio expand/collapse.
//
//   truncated (~140 chars + red "...")
//     -- click anywhere on bio --> expanded-medium
//   expanded-medium (~400 chars / one paragraph; trailing "..." if more available)
//     -- click "..." --> expanded-full
//     -- click text body --> truncated
//   expanded-full (entire stored bio, up to 2000 chars)
//     -- click anywhere --> truncated
//
// Single delegated onclick on the .dir-card-bio div routes based on (state, target).
// Bio text and ellipsis are rendered as innerHTML — children don't have their own handlers.
function _dirBioClick(e, el) {
  e.stopPropagation();
  const isMore = e.target && e.target.classList && e.target.classList.contains('bio-more');
  const medium = (el.dataset.medium || '').replace(/&quot;/g, '"');
  const full = (el.dataset.full || '').replace(/&quot;/g, '"');
  const short = (el.dataset.short || '').replace(/&quot;/g, '"');
  const hasMore = el.dataset.hasMore === '1';

  if (el.classList.contains('expanded-full')) {
    el.classList.remove('expanded-full');
    el.classList.add('truncated');
    el.innerHTML = `${short}<span class="bio-more">…</span>`;
    el.title = 'Read more';
    return;
  }
  if (el.classList.contains('expanded-medium')) {
    if (isMore && hasMore) {
      el.classList.remove('expanded-medium');
      el.classList.add('expanded-full');
      el.innerHTML = full;
      el.title = 'Click to collapse';
    } else {
      el.classList.remove('expanded-medium');
      el.classList.add('truncated');
      el.innerHTML = `${short}<span class="bio-more">…</span>`;
      el.title = 'Read more';
    }
    return;
  }
  // truncated → medium
  el.classList.remove('truncated');
  el.classList.add('expanded-medium');
  el.innerHTML = hasMore ? `${medium}<span class="bio-more">…</span>` : medium;
  el.title = hasMore ? 'Click "..." for full bio, or click text to collapse' : 'Click to collapse';
}
window._dirBioClick = _dirBioClick;

function _dirOpenPhoto(photoUrl, name) {
  if (!photoUrl) return;
  const existing = document.querySelector('.dir-lightbox');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'dir-lightbox';
  overlay.innerHTML = `
    <button class="dir-lightbox-close" aria-label="Close">&times;</button>
    <div class="dir-lightbox-content">
      <img class="dir-lightbox-img" src="${photoUrl}" alt="${name}">
      <div class="dir-lightbox-name">${name}</div>
    </div>
  `;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('dir-lightbox-close')) close(); });
  document.body.appendChild(overlay);
  const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}
window._dirOpenPhoto = _dirOpenPhoto;

window.renderComedianDirectory = renderComedianDirectory;

// ---- Modal ----
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderModal();
  if (window.va) window.va('event', { name: 'modal_open' });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  showBookmarkToast();
  updateSettingsBtnState();
  updateResetBtn();
  renderTabs();
  renderShows();
}

function renderModal(filter = '') {
  const prefs = loadPrefs();
  const filterLower = filter.toLowerCase();

  // Favs section
  const favList = document.getElementById('fav-list');
  favList.innerHTML = prefs.faves
    .filter(n => n.toLowerCase().includes(filterLower))
    .map(n => `<span class="chip fav-state" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`)
    .join('') || '<span style="color:var(--text-dim);font-size:13px;">None yet — tap names below</span>';
  document.getElementById('fav-count').textContent = `(${prefs.faves.length})`;

  // Skips section
  const skipList = document.getElementById('skip-list');
  skipList.innerHTML = prefs.skips
    .filter(n => n.toLowerCase().includes(filterLower))
    .map(n => `<span class="chip skip-state" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`)
    .join('') || '<span style="color:var(--text-dim);font-size:13px;">None yet</span>';
  document.getElementById('skip-count').textContent = `(${prefs.skips.length})`;

  // Alerts section
  const alerts = loadAlerts();
  const alertList = document.getElementById('alert-list');
  if (alertList) {
    alertList.innerHTML = alerts.comedians
      .filter(n => n.toLowerCase().includes(filterLower))
      .map(n => `<span class="chip alert-state" onclick="removeAlert('${n.replace(/'/g, "\\'")}')">${n} ${ICON.x}</span>`)
      .join('') || '<span style="color:var(--text-dim);font-size:13px;">No alerts set</span>';
    document.getElementById('alert-count').textContent = `(${alerts.comedians.length})`;
    const emailInput = document.getElementById('alert-email');
    if (emailInput && !emailInput.value) emailInput.value = alerts.email || '';
  }

  // Build per-venue comedian lists
  const allList = document.getElementById('all-list');

  const cellarComedians = new Set();
  Object.values(allData).flat().filter(Boolean).forEach(show => {
    show.comedians.forEach(n => cellarComedians.add(n));
  });

  const standComedians = new Set();
  standShows.forEach(show => show.comedians.forEach(n => standComedians.add(n)));

  const otherComedians = new Set();
  bigShows.forEach(evt => {
    if (evt.performers) evt.performers.split(/,\s*/).forEach(n => { if (n.trim()) otherComedians.add(n.trim()); });
  });
  gothamShows.forEach(show => {
    if (show.title) otherComedians.add(show.title.trim());
  });
  // Remove names already in Cellar/Stand from Others (avoid duplicates)
  cellarComedians.forEach(n => otherComedians.delete(n));
  standComedians.forEach(n => otherComedians.delete(n));

  function chipHtml(n) {
    let cls = 'chip';
    if (prefs.faves.includes(n)) cls += ' fav-state';
    else if (prefs.likes.includes(n)) cls += ' like-state';
    else if (prefs.skips.includes(n)) cls += ' skip-state';
    return `<span class="${cls}" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`;
  }

  const cellarSorted = [...cellarComedians].sort().filter(n => n.toLowerCase().includes(filterLower));
  const standSorted = [...standComedians].sort().filter(n => n.toLowerCase().includes(filterLower));
  const otherSorted = [...otherComedians].sort().filter(n => n.toLowerCase().includes(filterLower));

  let html = '';
  if (cellarSorted.length > 0) {
    html += `<h3 class="modal-section-title">Comedy Cellar</h3>`;
    html += `<div class="chip-list">${cellarSorted.map(chipHtml).join('')}</div>`;
  }
  if (standSorted.length > 0) {
    html += `<h3 class="modal-section-title" style="margin-top:16px;">The Stand</h3>`;
    html += `<div class="chip-list">${standSorted.map(chipHtml).join('')}</div>`;
  }
  if (otherSorted.length > 0) {
    html += `<h3 class="modal-section-title" style="margin-top:16px;">Big Shows</h3>`;
    html += `<div class="chip-list">${otherSorted.map(chipHtml).join('')}</div>`;
  }
  allList.innerHTML = html;
}

function modalCycle(name) {
  cycleComedian(name);
  const search = document.getElementById('comedian-search').value;
  renderModal(search);
}

// ---- Reset filters visibility ----
function updateResetBtn() {
  const btn = document.getElementById('reset-filters');
  const row = document.getElementById('reset-row');
  if (!btn || !row) return;
  const sortVal = document.getElementById('sort-select')?.value;
  const prefs = loadPrefs();
  const hasRatedComedians = prefs.faves.length > 0 || prefs.skips.length > 0 || prefs.likes.length > 0;
  const anyActive =
    document.getElementById('quick-mode')?.checked ||
    !document.getElementById('picture-mode')?.checked ||
    (sortVal !== 'none' && hasRatedComedians) ||
    document.getElementById('expand-bios')?.checked ||
    document.getElementById('expand-long-bios')?.checked ||
    (document.getElementById('time-filter')?.value !== 'any') ||
    !!window._timeFilterMin ||
    document.getElementById('hide-sold-out')?.checked ||
    (typeof activeNeighborhood !== 'undefined' && activeNeighborhood !== 'all') ||
    !!activeComedianFilter;
  btn.style.visibility = anyActive ? 'visible' : 'hidden';
  // Show row if reset button is visible OR filters panel is open
  const filtersOpen = document.getElementById('filters-inline')?.style.display !== 'none';
  row.classList.toggle('visible', anyActive || filtersOpen);
}

// ---- Theme toggle ----
// ---- Venue-specific footer info ----
function updateFooterInfo() {
  const el = document.getElementById('footer-venue-info');
  if (!el) return;
  if (activeSource === 'cellar') {
    el.innerHTML = `
      <p class="footer-venue-detail">Nearby parking: Minetta / W 3rd St — between 6th Ave &amp; MacDougal</p>
      <p class="footer-venue-detail">Cover: $0 (2-drink minimum, ~$12-15/drink). Cash &amp; card accepted.</p>
      <p class="footer-venue-detail">Shows are about 1 hour 15 min (5-7 comics). Arrive 15 min early — seats are first-come in your reservation group.</p>
      <p class="footer-venue-detail">3 rooms: MacDougal St (original), Village Underground (bigger stage), Fat Black Pussycat (intimate)</p>
    `;
  } else if (activeSource === 'the-stand') {
    el.innerHTML = `
      <p class="footer-venue-detail">The Stand NYC — 239 Third Ave (between 19th &amp; 20th St), Gramercy</p>
      <p class="footer-venue-detail">Tickets: $20-25 + 2-drink minimum. Full food menu available.</p>
      <p class="footer-venue-detail">Shows run ~90 min. Reserved seating — book early for front rows.</p>
    `;
  } else {
    el.innerHTML = '';
  }
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  function updateTitle() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  updateTitle();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cellar-theme', next);
    updateTitle();
  });
}

function initSettingsJingle() {
  if (localStorage.getItem('settings-jingle-shown')) return;
  localStorage.setItem('settings-jingle-shown', '1');
  const btn = document.getElementById('open-settings');
  if (!btn) return;
  btn.classList.add('jingle-intro');
  btn.addEventListener('animationend', () => {
    btn.classList.remove('jingle-intro');
  }, { once: true });
}

// ---- Tagline helpers ----
const comedianTaglines = {};       // Cellar API taglines (live)
const comedianWikiBios = {};       // Wikipedia bios (last resort)

// Venue-aware bio lookup: venue-specific → NYCC DB → Cellar tagline → DB fallbacks → Wikipedia → ''
function getBioForVenue(name, venueSource) {
  const dbEntry = comedianDB.find(c => c.name === name);
  // 1. If Cellar show, prefer Cellar live tagline
  if (venueSource === 'cellar') {
    const cellarTag = comedianTaglines[name];
    if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
    // Fallback to prebaked Cellar tagline from DB
    if (dbEntry?.tagline_cellar && !isGenericBio(dbEntry.tagline_cellar)) return dbEntry.tagline_cellar;
  }
  // 2. If Stand show, prefer Stand bio from DB
  if (venueSource === 'stand') {
    if (dbEntry?.bio_stand && !isGenericBio(dbEntry.bio_stand)) return dbEntry.bio_stand;
  }
  // 3. NYCC bio from DB (works for any venue as fallback)
  if (dbEntry?.bio && !isGenericBio(dbEntry.bio)) return dbEntry.bio;
  // 4. Cellar tagline as fallback for non-Cellar shows too
  const cellarTag = comedianTaglines[name];
  if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
  // 5. Prebaked Cellar tagline from DB
  if (dbEntry?.tagline_cellar && !isGenericBio(dbEntry.tagline_cellar)) return dbEntry.tagline_cellar;
  // 6. Wikipedia — live map first, then prebaked DB
  const wiki = comedianWikiBios[name];
  if (wiki && !isGenericBio(wiki)) return wiki;
  if (dbEntry?.bio_wiki && !isGenericBio(dbEntry.bio_wiki)) return dbEntry.bio_wiki;
  return '';
}

function isGenericBio(bio) {
  if (!bio) return true;
  const lower = bio.toLowerCase();
  // Filler patterns (no real content) — block regardless of opener
  if (/performs regularly|regular at the|clubs across the city|comedy circuit|nyc comedy scene|performing on the/.test(lower) && bio.length < 200) return true;
  const startsGeneric = /^[a-z\s.'-]+ is a (stand-up )?comedian/.test(lower);
  if (startsGeneric) {
    // If it has real credits, keep it despite generic opener
    if (/appeared on|starred in|featured on|netflix|hbo|comedy central|conan|tonight show|letterman|fallon|colbert|snl|saturday night live|published|author|podcast|youtube|special|award|emmy|grammy/.test(lower)) return false;
    // Block all generic filler patterns
    if (/performs (regularly )?on the/.test(lower) || /performing (in|on)/.test(lower) ||
        /performs at clubs/.test(lower) || /regular at/.test(lower) ||
        /known for (his|her|their) (unique|sharp|fresh|energetic)/.test(lower) ||
        /across the city/.test(lower) || /comedy scene/.test(lower)) return true;
    // Short generic bios with no substance
    if (bio.length < 120) return true;
  }
  return false;
}

function toProperCase(str) {
  // Convert ALL CAPS taglines to proper case
  if (str !== str.toUpperCase()) return str; // already mixed case
  return str.toLowerCase().replace(/(?:^|\s|["'(])\w/g, c => c.toUpperCase())
    .replace(/\bNbc\b/g, 'NBC').replace(/\bHbo\b/g, 'HBO').replace(/\bSnl\b/g, 'SNL')
    .replace(/\bBet\b/g, 'BET').replace(/\bFox\b/g, 'FOX').replace(/\bMtv\b/g, 'MTV')
    .replace(/\bIfc\b/g, 'IFC').replace(/\bTbs\b/g, 'TBS').replace(/\bWb\b/g, 'WB')
    .replace(/\bNyc\b/g, 'NYC').replace(/\bNycf\b/g, 'NYCF').replace(/\bUsa\b/g, 'USA')
    .replace(/\bTv\b/gi, 'TV').replace(/\bLgbtq\b/g, 'LGBTQ');
}

// ---- Reserve button click tracking ----
function trackReserve(el) {
  // Increment localStorage counter
  const count = parseInt(localStorage.getItem('cellar-reserve-clicks') || '0') + 1;
  localStorage.setItem('cellar-reserve-clicks', count.toString());
  // Log for Vercel Analytics custom event (if available)
  if (window.va) window.va('event', { name: 'reserve_click', data: { url: el?.href || '', count } });
}

// ---- Close info popups on click outside ----
document.addEventListener('click', (e) => {
  if (!e.target.closest('.info-icon')) {
    document.querySelectorAll('.info-popup.visible').forEach(p => p.classList.remove('visible'));
  }
});

// ---- Init ----
async function init() {
  // Mode toggle (comedy / jazz). When jazz, the rest of the comedy pipeline is skipped.
  if (typeof setupModeSelect === 'function') setupModeSelect();
  if (typeof getMode === 'function' && getMode() === 'jazz') {
    await initJazzMode();
    return;
  }

  // Import prefs from URL hash (shared link) before anything renders
  await loadPrefsFromHash();

  dates = getDateRange();
  activeDate = 'all';

  // Fetch all sources in parallel — prebaked static JSON first, live API fallback for any gap.
  const [batchData] = await Promise.all([
    fetchWithTimeout(STATIC_CELLAR, {}, 5000).then(r => r.json())
      .catch(() => fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json()))
      .catch(() => null)
      .then(async (d) => {
        // If static cache covers fewer dates than `dates`, fetch the rest from the live API and merge.
        if (!d || !d.results) return d;
        const haveDates = new Set(Object.keys(d.results));
        const missing = dates.map(formatDateParam).filter(s => !haveDates.has(s));
        if (missing.length === 0) return d;
        try {
          const live = await fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json());
          if (live?.results) Object.assign(d.results, live.results);
        } catch {}
        return d;
      }),
    fetchTheStand(),
    fetchBigShows(),
    fetchNYCC(),
    loadComedianDB(),
    fetchGotham(),
    fetchAvailability()
  ]);

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const dayData = batchData?.results?.[dateStr];
    const html = dayData?.show?.html || '';
    if (html) {
      allData[dateStr] = parseShows(html, dateStr);
      allData[dateStr].forEach(show => {
        show.comedians.forEach(name => allComediansSeen.add(name));
      });
    } else {
      allData[dateStr] = null;
    }
  });

  // Add Stand comedians to the seen list too
  standShows.forEach(show => {
    show.comedians.forEach(name => allComediansSeen.add(name));
  });

  // Add Gotham shows to seen list
  gothamShows.forEach(show => {
    if (show.title) allComediansSeen.add(show.title.trim());
  });

  // Add Big Shows performers to seen list
  bigShows.forEach(evt => {
    if (evt.performers) {
      evt.performers.split(/,\s*/).forEach(n => { if (n.trim()) allComediansSeen.add(n.trim()); });
    }
    if (evt.title) allComediansSeen.add(evt.title.trim());
  });

  // Show warning if any data source failed
  const failedSources = [];
  if (!batchData) failedSources.push('Comedy Cellar');
  if (!standShows.length) failedSources.push('The Stand');
  if (!bigShows.length) failedSources.push('Big Shows');
  if (failedSources.length) {
    const warn = document.createElement('div');
    warn.className = 'data-warning';
    warn.innerHTML = `${ICON.warning} Could not load: ${failedSources.join(', ')}. <button onclick="this.parentElement.remove()">${ICON.x}</button>`;
    document.getElementById('shows-container').prepend(warn);
  }

  document.getElementById('loading').style.display = 'none';
  // Default to big picture mode
  const pmEl = document.getElementById('picture-mode');
  if (pmEl && !pmEl.checked) pmEl.checked = true;
  initTheme();
  initCalendar();
  initSettingsJingle();
  updateSettingsBtnState();
  updateShareBtn();
  applyPathToSource();
  syncUrlToSource(activeSource);
  renderSourceTabs();
  renderTabs();
  renderShows();
  updateFooterInfo();
  document.getElementById('schedule-filter-area')?.classList.add('ready');

  // Eagerly pull Cellar days 31-60 in the background so the full date window is
  // exposed without a "More days" tab. Non-blocking — first paint is already
  // done; loadMoreDays() re-renders the strip when the extra days arrive.
  loadMoreDays();

  // Open My Comedians modal if #alerts in URL
  if (window.location.hash === '#alerts') {
    openModal();
  }

  // Enrich bios from Wikipedia in background (don't block render)
  enrichBiosFromWikipedia().then(() => {
    // Re-render to show new bios if user has bios toggled on
    if (document.getElementById('expand-bios')?.checked || document.getElementById('expand-long-bios')?.checked) {
      renderShows();
    }
  });

  // Auto-schedule local reminders for favorited comedians' upcoming shows (native only)
  function _collectReminderItems() {
    const items = [];
    Object.entries(allData).forEach(([dateStr, shows]) => {
      (shows || []).forEach(show => {
        items.push({ dateStr, time: show.time, title: show.room || 'Comedy Cellar', venue: 'Comedy Cellar', comedians: show.comedians || [] });
      });
    });
    (standShows || []).forEach(show => {
      if (show.date && show.time) items.push({ dateStr: show.date, time: show.time, title: show.room || 'The Stand', venue: 'The Stand', comedians: show.comedians || [] });
    });
    return items;
  }
  window._rescheduleReminders = function() {
    if (!Native.isNative()) return;
    Native.scheduleReminders(_collectReminderItems());
  };
  window._rescheduleReminders();

  // Venue source tab listeners
  document.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      Native.selection();
      const prevDate = activeDate;
      // Unselect: clicking active source goes back to All Venues
      const newSource = btn.dataset.source;
      activeSource = (newSource === activeSource && newSource !== 'all') ? 'all' : newSource;
      syncUrlToSource(activeSource);
      activeVenue = 'all';
      activeStandRoom = 'all';
      activeNeighborhood = 'all';
      // Keep the selected date across tabs only if the new source actually has
      // shows that day — otherwise reset to Full Schedule so the switch never
      // lands on a blank screen (e.g. Big Shows has nothing on the picked date).
      activeDate = (prevDate && prevDate !== 'all' && dateInActiveSource(prevDate))
        ? prevDate
        : 'all';
      if (window.va) window.va('event', { name: 'tab_switch', data: { source: activeSource } });
      renderSourceTabs();
      renderTabs();
      renderShows();
      updateFooterInfo();
    });
  });

  // Filter listeners
  document.getElementById('hide-skips').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('only-faves').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('show-photos')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('time-filter')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('sort-select')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });
  document.getElementById('expand-bios')?.addEventListener('change', (e) => {
    if (e.target.checked) { const lb = document.getElementById('expand-long-bios'); if (lb) lb.checked = false; }
    updateResetBtn(); renderShows();
  });
  document.getElementById('expand-long-bios')?.addEventListener('change', (e) => {
    if (e.target.checked) { const sb = document.getElementById('expand-bios'); if (sb) sb.checked = false; }
    updateResetBtn(); renderShows();
  });
  document.getElementById('bio-mode')?.addEventListener('change', (e) => {
    const sb = document.getElementById('expand-bios');
    const lb = document.getElementById('expand-long-bios');
    if (sb) sb.checked = e.target.value === 'short';
    if (lb) lb.checked = e.target.value === 'long';
    // Show short label after selection
    const sel = e.target;
    sel.options[0].text = 'Bios';
    sel.options[1].text = sel.value === 'short' ? 'Short' : 'Short bios';
    sel.options[2].text = sel.value === 'long' ? 'Long' : 'Long bios';
    updateResetBtn(); renderShows();
  });
  document.getElementById('quick-mode')?.addEventListener('change', (e) => {
    updateResetBtn();
    const hint = document.getElementById('quick-mode-hint');
    if (hint) {
      hint.classList.toggle('visible', e.target.checked);
    }
  });
  document.getElementById('picture-mode')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });
  document.getElementById('no-photo-filter')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });

  // Time range slider drives hidden time-filter select + earliest start
  const timeSteps = ['any', '19:00', '20:00', '21:00', '22:00', '23:00'];
  const timeLabels = ['Any', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'];
  const sliderMin = document.getElementById('time-slider-min');
  const sliderMax = document.getElementById('time-slider-max');
  const rangeValue = document.getElementById('time-range-value');
  const rangeFill = document.getElementById('time-range-fill');
  function updateTimeRange() {
    if (!sliderMin || !sliderMax) return;
    let lo = parseInt(sliderMin.value);
    let hi = parseInt(sliderMax.value);
    if (lo > hi) { sliderMin.value = hi; sliderMax.value = lo; lo = parseInt(sliderMin.value); hi = parseInt(sliderMax.value); }
    // Update fill bar position
    if (rangeFill) {
      const pctL = (lo / 5) * 100;
      const pctR = (hi / 5) * 100;
      rangeFill.style.left = pctL + '%';
      rangeFill.style.width = (pctR - pctL) + '%';
    }
    // Update label
    if (rangeValue) {
      if (lo === 0 && hi === 5) rangeValue.textContent = 'Any';
      else if (lo === 0) rangeValue.textContent = 'Before ' + timeLabels[hi];
      else if (hi === 5) rangeValue.textContent = 'After ' + timeLabels[lo];
      else if (lo === hi) rangeValue.textContent = timeLabels[lo];
      else rangeValue.textContent = timeLabels[lo] + ' – ' + timeLabels[hi];
    }
    // Drive the hidden time-filter (latest/max)
    const tf = document.getElementById('time-filter');
    if (tf) { tf.value = timeSteps[hi]; }
    // Set global earliest start
    window._timeFilterMin = lo === 0 ? null : timeSteps[lo];
    updateResetBtn(); renderShows();
  }
  if (sliderMin) sliderMin.addEventListener('input', updateTimeRange);
  if (sliderMax) sliderMax.addEventListener('input', updateTimeRange);
  // Initialize fill bar
  if (rangeFill) { rangeFill.style.left = '0%'; rangeFill.style.width = '100%'; }

  // Reset filters
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    document.getElementById('hide-skips').checked = false;
    document.getElementById('only-faves').checked = false;
    const ss = document.getElementById('sort-select'); if (ss) ss.value = 'none';
    document.getElementById('expand-bios').checked = false;
    const elb = document.getElementById('expand-long-bios'); if (elb) elb.checked = false;
    const bm = document.getElementById('bio-mode');
    if (bm) { bm.value = 'none'; bm.options[1].text = 'Short bios'; bm.options[2].text = 'Long bios'; }
    document.getElementById('quick-mode').checked = false;
    const pm = document.getElementById('picture-mode'); if (pm) pm.checked = true;
    const npf = document.getElementById('no-photo-filter'); if (npf) npf.checked = false;
    const hso = document.getElementById('hide-sold-out'); if (hso) hso.checked = false;
    const sp = document.getElementById('show-photos'); if (sp) sp.checked = true;
    const tf = document.getElementById('time-filter');
    if (tf) tf.value = 'any';
    const tfv = document.getElementById('time-filter-visible');
    if (tfv) tfv.value = 'any';
    const tsMin = document.getElementById('time-slider-min');
    const tsMax = document.getElementById('time-slider-max');
    if (tsMin) tsMin.value = 0;
    if (tsMax) tsMax.value = 5;
    window._timeFilterMin = null;
    const rv = document.getElementById('time-range-value');
    if (rv) rv.textContent = 'Any';
    const rf = document.getElementById('time-range-fill');
    if (rf) { rf.style.left = '0%'; rf.style.width = '100%'; }
    activeVenue = 'all';
    activeStandRoom = 'all';
    activeBigVenue = 'all';
    activeNeighborhood = 'all';
    activeComedianFilter = null;
    activeSearchQuery = '';
    updateResetBtn();
    renderShows();
  });

  // Modal listeners
  document.getElementById('open-settings').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-done').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  // Escape closes whichever modal overlay is open (My Comedians / Settings).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const myComedians = document.getElementById('modal-overlay');
    if (myComedians && !myComedians.classList.contains('hidden')) { closeModal(); return; }
    const appSettings = document.getElementById('app-settings-overlay');
    if (appSettings && !appSettings.classList.contains('hidden')) {
      document.getElementById('app-settings-close')?.click();
    }
  });
  document.getElementById('comedian-search').addEventListener('input', e => {
    renderModal(e.target.value);
  });
  document.getElementById('save-alert-email')?.addEventListener('click', () => {
    const email = document.getElementById('alert-email')?.value?.trim();
    if (email && email.includes('@')) {
      setAlertEmail(email);
      const btn = document.getElementById('save-alert-email');
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    }
  });
  document.getElementById('reset-prefs').addEventListener('click', () => {
    if (confirm('Reset all favorites and skips?')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ faves: [], skips: [], likes: [] }));
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('comedian-search').value = '';
      renderModal();
      renderTabs();
      updateSettingsBtnState();
      updateResetBtn();
      updateShareBtn();
    }
  });

  // "Filters" dropdown toggle
  const filtersBtn = document.getElementById('filters-toggle');
  const filtersInline = document.getElementById('filters-inline');
  if (filtersBtn && filtersInline) {
    filtersBtn.addEventListener('click', () => {
      const visible = filtersInline.style.display !== 'none';
      filtersInline.style.display = visible ? 'none' : 'flex';
      filtersBtn.textContent = visible ? 'Filters ▾' : 'Filters ▴';
      filtersBtn.classList.toggle('active', !visible);
      updateResetBtn();
    });
  }

  // Keep the toolbar capped at 3 rows; re-evaluate on resize and after fonts load.
  let _reflowTimer = null;
  const _scheduleReflow = () => { clearTimeout(_reflowTimer); _reflowTimer = setTimeout(reflowToolbar, 120); };
  window.addEventListener('resize', _scheduleReflow);
  window.addEventListener('load', reflowToolbar);
  if (typeof reflowToolbar === 'function') reflowToolbar();

  async function buildShareUrl() {
    // Unified format includes prefs + non-default settings.
    if (typeof window.__tonightNycBuildShareLink === 'function') {
      try { return await window.__tonightNycBuildShareLink(); } catch { /* fall through */ }
    }
    const prefs = loadPrefs();
    try {
      if (typeof CompressionStream !== 'undefined') {
        const compressed = await compressPrefs(prefs);
        return window.location.origin + window.location.pathname + '#p=' + compressed;
      } else {
        throw new Error('no CompressionStream');
      }
    } catch {
      const params = new URLSearchParams();
      if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
      if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
      if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
      return window.location.origin + window.location.pathname + '#' + params.toString();
    }
  }

  async function doShare(sourceBtn, onCopyFeedback) {
    const url = await buildShareUrl();
    const result = await Native.share('My Comedians', url);
    if (result === 'clipboard' || result === 'failed') {
      onCopyFeedback && onCopyFeedback();
    }
  }

  document.getElementById('share-link').addEventListener('click', () => {
    Native.impact('Light');
    doShare(null, () => {
      const btn = document.getElementById('share-link');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Share Link'; }, 2000);
    });
  });

  document.getElementById('import-go')?.addEventListener('click', async () => {
    const input = document.getElementById('import-url');
    const status = document.getElementById('import-status');
    const raw = (input.value || '').trim();
    if (!raw) return;
    const pMatch = raw.match(/[#?&]p=([A-Za-z0-9_-]+)/);
    if (!pMatch) {
      status.textContent = 'Could not find a share code in that link. Make sure the URL contains #p=...';
      status.style.color = 'var(--accent)';
      return;
    }
    try {
      Native.impact('Light');
      const imported = await decompressPrefs(pMatch[1]);
      const current = loadPrefs();
      const merged = {
        faves: [...new Set([...(current.faves || []), ...(imported.faves || [])])],
        skips: [...new Set([...(current.skips || []), ...(imported.skips || [])])],
        likes: [...new Set([...(current.likes || []), ...(imported.likes || [])])]
      };
      savePrefs(merged);
      input.value = '';
      Native.impact('Medium');
      if (typeof renderModal === 'function') renderModal('');
      if (typeof renderShows === 'function') renderShows();
      updateShareBtn();
      status.style.color = 'var(--text-dim)';
      status.textContent = `Imported ${imported.faves.length} faves, ${imported.skips.length} skips, ${imported.likes.length} likes. Merged with what you had.`;
      setTimeout(() => {
        status.textContent = 'Merges favorites & skips from another device’s share link with what you have here.';
      }, 5000);
    } catch (e) {
      console.error('Import failed:', e);
      status.style.color = 'var(--accent)';
      status.textContent = 'Could not import — link may be invalid or corrupted.';
    }
  });

  document.getElementById('header-share').addEventListener('click', () => {
    Native.impact('Light');
    doShare(null, () => {
      const btn = document.getElementById('header-share');
      btn.querySelector('.share-icon-svg').style.display = 'none';
      btn.querySelector('.share-check').style.display = '';
      btn.title = 'Link copied!';
      setTimeout(() => {
        btn.querySelector('.share-icon-svg').style.display = '';
        btn.querySelector('.share-check').style.display = 'none';
        btn.title = 'Copy share link';
      }, 2000);
    });
  });
}

init();

// ---- Deep-linkable venue views: URL path <-> activeSource tab ----
// Each venue tab gets its own shareable URL (/cellar, /stand, /big, /comics).
// vercel.json rewrites these to index.html, so they all load the same SPA — the
// path only chooses which tab is active. The prefs hash (#p=...) lives in a
// separate slot, so path and shared-picks never collide (e.g. /cellar#p=abc).
const VIEW_BY_PATH = {
  '/cellar': 'cellar',
  '/stand': 'the-stand',
  '/big': 'big-shows',
  '/comics': 'comedians',
};
const VIEW_META = {
  'all':       { path: '/',       title: 'Tonight NYC — Comedy Lineups' },
  'cellar':    { path: '/cellar', title: 'Comedy Cellar Tonight — Lineups | Tonight NYC' },
  'the-stand': { path: '/stand',  title: 'The Stand Tonight — Lineups | Tonight NYC' },
  'big-shows': { path: '/big',    title: 'Big Comedy Shows in NYC | Tonight NYC' },
  'comedians': { path: '/comics', title: "NYC Comedians — Who's On Tonight | Tonight NYC" },
};

function viewSourceFromPath() {
  const p = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  return VIEW_BY_PATH[p] || null;
}

// Set the active tab from the URL path. An explicit path wins over saved defaultTab.
function applyPathToSource() {
  const s = viewSourceFromPath();
  if (s) activeSource = s;
}

// Reflect the active tab in the URL path + document title, preserving the prefs hash.
function syncUrlToSource(source) {
  const meta = VIEW_META[source] || VIEW_META.all;
  const current = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  if (current !== meta.path) {
    history.replaceState(null, '', meta.path + window.location.hash);
  }
  document.title = meta.title;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute('href', 'https://tonightnyc.com' + (meta.path === '/' ? '' : meta.path));
  }
}

function resetToHome() {
  if (typeof getMode === 'function' && getMode() === 'jazz') {
    if (typeof jazzResetHome === 'function') jazzResetHome();
    return;
  }
  activeSource = 'all';
  syncUrlToSource('all');
  activeDate = 'all';
  activeVenue = 'all';
  activeStandRoom = 'all';
  activeBigVenue = 'all';
  activeNeighborhood = 'all';
  activeComedianFilter = null;
  activeSearchQuery = '';
  renderSourceTabs();
  renderTabs();
  renderShows();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

(function setupHeaderHome() {
  const go = () => { Native.impact('Light'); resetToHome(); };
  const region = document.getElementById('header-home');
  region.addEventListener('click', go);
  region.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
})();

(function setupPullToRefresh() {
  const indicator = document.getElementById('ptr-indicator');
  // Wrap all body children except the indicator into a #page-wrap div so the pull
  // transform applies to the wrapper, NOT body. This keeps #ptr-indicator (a sibling
  // of the wrapper) viewport-fixed instead of being trapped by body's transform's
  // new containing block. Idempotent — runs once.
  let pageWrap = document.getElementById('page-wrap');
  if (!pageWrap && indicator) {
    pageWrap = document.createElement('div');
    pageWrap.id = 'page-wrap';
    Array.from(document.body.children).forEach(child => {
      if (child !== indicator) pageWrap.appendChild(child);
    });
    document.body.appendChild(pageWrap);
  }
  const THRESHOLD = 70;
  const MAX_PULL = 110;
  let startY = 0;
  let pulling = false;
  let pullingClass = false;
  let pullDistance = 0;
  let refreshing = false;
  let pendingDy = null;
  let rafId = 0;

  function isScrollLocked() {
    // PTR should only fire when the main page is at the top.
    // Block it when any modal/expanded overlay is open OR when the touch happens inside one.
    if (document.querySelector('.modal-overlay:not(.hidden)')) return true;
    return false;
  }

  function applyPull() {
    rafId = 0;
    if (pendingDy === null || !pulling) return;
    if (pendingDy <= 0) {
      pullDistance = 0;
      if (pullingClass) {
        indicator.classList.remove('pulling');
        pageWrap?.classList.remove('ptr-pulling');
        pullingClass = false;
      }
      if (pageWrap) pageWrap.style.transform = '';
      indicator.style.opacity = '';
      return;
    }
    pullDistance = Math.min(pendingDy * 0.55, MAX_PULL);
    if (!pullingClass) {
      indicator.classList.add('pulling');
      pageWrap?.classList.add('ptr-pulling');
      pullingClass = true;
    }
    if (pageWrap) pageWrap.style.transform = `translateY(${pullDistance}px)`;
    indicator.style.opacity = Math.min(pullDistance / 40, 1);
  }

  function resetPull() {
    pulling = false;
    pullDistance = 0;
    pendingDy = null;
    if (pullingClass) {
      indicator.classList.remove('pulling');
      pageWrap?.classList.remove('ptr-pulling');
      pullingClass = false;
    }
    if (pageWrap) pageWrap.style.transform = '';
    if (!refreshing) indicator.style.opacity = '';
  }

  document.addEventListener('touchstart', (e) => {
    if (refreshing) return;
    if (window.scrollY > 0) { pulling = false; return; }
    if (isScrollLocked()) { pulling = false; return; }
    if (e.target.closest('.modal-overlay, .calendar-popup, .expanded-card, .comedian-bio-panel')) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    pullDistance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || refreshing) return;
    pendingDy = e.touches[0].clientY - startY;
    if (!rafId) rafId = requestAnimationFrame(applyPull);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling || refreshing) { pulling = false; return; }
    if (pullDistance >= THRESHOLD) {
      refreshing = true;
      pulling = false;
      if (pullingClass) {
        indicator.classList.remove('pulling');
        pageWrap?.classList.remove('ptr-pulling');
        pullingClass = false;
      }
      // Hold the gap open while we refetch
      if (pageWrap) pageWrap.style.transform = `translateY(${THRESHOLD}px)`;
      indicator.classList.add('refreshing');
      indicator.style.opacity = '1';
      Native.impact('Medium');
      // In-place refresh: re-fetch data, preserve tab/date state, snap back.
      refreshShowsInPlace().finally(() => {
        if (pageWrap) pageWrap.style.transform = '';
        indicator.classList.remove('refreshing');
        indicator.style.opacity = '';
        refreshing = false;
      });
    } else {
      resetPull();
    }
  }, { passive: true });

  document.addEventListener('touchcancel', resetPull, { passive: true });
})();

// Block pinch-zoom: Safari ignores user-scalable=no for accessibility, so explicitly
// preventDefault on gesture* events. (touch-action: pan-x pan-y handles double-tap zoom.)
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  document.addEventListener(ev, (e) => e.preventDefault())
);

// Global poster preview — renders outside card stacking contexts so opacity doesn't trap it
(function() {
  let overlay = null;
  document.addEventListener('mouseover', e => {
    const wrap = e.target.closest('.poster-wrap');
    if (!wrap) return;
    const img = wrap.querySelector('.poster-preview');
    if (!img) return;
    if (overlay) overlay.remove();
    overlay = document.createElement('img');
    overlay.id = 'global-poster-preview';
    overlay.src = img.src;
    overlay.alt = img.alt;
    document.body.appendChild(overlay);
  });
  document.addEventListener('mouseout', e => {
    const wrap = e.target.closest('.poster-wrap');
    if (wrap && overlay) { overlay.remove(); overlay = null; }
  });
})();

// Back to top button
(function() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 200);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// PWA install prompt
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'inline-block';
});

function pwaInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(() => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });
}

// Cmd+F keyboard shortcut intentionally NOT bound — native browser find should win.
// The popup is reached via the toolbar search-icon button (showSearchPopup, exposed below).
/*
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    showSearchPopup();
  }
});
*/

// Build a unified searchable index: comedians, named shows, and venues.
function _buildSearchIndex() {
  const items = [];
  const seen = new Set();
  const push = (label, type) => {
    if (!label) return;
    const key = type + '|' + label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ label, type });
  };
  if (typeof allComediansSeen !== 'undefined') [...allComediansSeen].forEach(n => push(n, 'comedian'));
  ['Comedy Cellar', 'The Stand', 'Gotham Comedy Club', 'NY Comedy Club'].forEach(v => push(v, 'venue'));
  try { (typeof bigShows !== 'undefined' ? bigShows : []).forEach(e => { push(e.venue, 'venue'); push(e.title, 'show'); }); } catch {}
  try { (typeof standShows !== 'undefined' ? standShows : []).forEach(s => push(s.title, 'show')); } catch {}
  try { (typeof gothamShows !== 'undefined' ? gothamShows : []).forEach(s => push(s.title, 'show')); } catch {}
  return items;
}

function showSearchPopup() {
  let overlay = document.getElementById('search-popup-overlay');
  if (overlay) { overlay.remove(); return; }
  const index = _buildSearchIndex();
  overlay = document.createElement('div');
  overlay.id = 'search-popup-overlay';
  overlay.innerHTML = `
    <div class="search-popup">
      <input type="text" id="search-popup-input" placeholder="Search comedians, shows, venues…" autocomplete="off" />
      <div id="search-popup-results"></div>
      <div class="search-popup-actions">
        <button onclick="openModal();document.getElementById('search-popup-overlay')?.remove();"><b>My</b> Comedians</button>
        <button onclick="document.querySelector('.venue-source-tab[data-source=comedians]')?.click();document.getElementById('search-popup-overlay')?.remove();"><b>All</b> Comedians</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const esc = s => String(s).replace(/'/g, "\\'");
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const input = document.getElementById('search-popup-input');
  input.focus();
  const TYPE_LABEL = { comedian: 'Comedian', show: 'Show', venue: 'Venue' };
  const TYPE_RANK = { comedian: 0, show: 1, venue: 2 };
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const results = document.getElementById('search-popup-results');
    if (!q) { results.innerHTML = ''; return; }
    const matches = index
      .filter(it => it.label.toLowerCase().includes(q))
      .sort((a, b) => (TYPE_RANK[a.type] - TYPE_RANK[b.type]) || a.label.localeCompare(b.label))
      .slice(0, 10);
    // For comedians use exact filterByComedian; for shows/venues use free-text search.
    results.innerHTML = matches.map(it => {
      const action = it.type === 'comedian'
        ? `filterByComedian('${esc(it.label)}')`
        : `setSearchQuery('${esc(it.label)}')`;
      return `<button class="search-result-item" onclick="${action};document.getElementById('search-popup-overlay')?.remove();">${escHtml(it.label)}<span class="search-result-type">${TYPE_LABEL[it.type]}</span></button>`;
    }).join('') || `<button class="search-result-item" onclick="setSearchQuery('${esc(q)}');document.getElementById('search-popup-overlay')?.remove();">Search all for “${escHtml(q)}”</button>`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) { setSearchQuery(q); close(); }
    }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// Expose functions needed by inline onclick handlers (terser mangles names)
window.openModal = openModal;
window.closeModal = closeModal;
window.modalCycle = modalCycle;
window.handleComedianClick = handleComedianClick;
window.copyPrefsUrl = copyPrefsUrl;
window.setVenue = setVenue;
window.setPref = setPref;
window.setStandRoom = setStandRoom;
window.setBigVenue = setBigVenue;
window.toggleAlertBtn = toggleAlertBtn;
window.filterByComedian = filterByComedian;
window.setSearchQuery = setSearchQuery;
window.clearSearch = clearSearch;
window.trackReserve = trackReserve;
window.removeAlert = removeAlert;
window.expandBioInPanel = expandBioInPanel;
window.showSearchPopup = showSearchPopup;
window.pwaInstall = pwaInstall;

// In-place refresh used by pull-to-refresh: refetch data sources, re-parse
// cellar HTML, re-render the current view without resetting tab/date filters.
async function refreshShowsInPlace() {
  try {
    const [batchData] = await Promise.all([
      fetchWithTimeout(STATIC_CELLAR, {}, 5000).then(r => r.json())
        .catch(() => fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json()))
        .catch(() => null),
      fetchTheStand(),
      fetchBigShows(),
      fetchNYCC(),
      fetchGotham(),
      fetchAvailability()
    ]);
    if (batchData?.results) {
      dates.forEach(d => {
        const dateStr = formatDateParam(d);
        const dayData = batchData.results[dateStr];
        const html = dayData?.show?.html || '';
        if (html) allData[dateStr] = parseShows(html, dateStr);
      });
    }
    renderShows();
  } catch (e) {
    console.error('refreshShowsInPlace failed:', e);
  }
}

// === App Settings (brand color, defaults, filters, unified share/import, QR, toast) ===
(function setupAppSettings(){
  const KEY = 'tonight-nyc-settings';
  const DEFAULTS = {
    accent: '#e63636',
    defaultTab: 'all',
    scheduleDay: 'all',
    neighborhood: 'all',
    soldOutMode: 'all',
    timeFilter: 'any',
    sort: 'none',
    bioMode: 'none',
    ratingsMode: 'off',
  };
  const PILL_GROUPS = {
    defaultTab: 'default-tab-pills',
    scheduleDay: 'default-schedule-pills',
    neighborhood: 'default-neighborhood-pills',
    soldOutMode: 'default-soldout-pills',
    timeFilter: 'default-time-pills',
    sort: 'default-sort-pills',
    bioMode: 'default-bio-pills',
    ratingsMode: 'default-ratings-pills',
  };
  // Mirror selects (hidden) we keep so external code that polls these IDs still works.
  const MIRROR_SELECTS = {
    defaultTab: 'default-tab-select',
    soldOutMode: 'default-soldout-mode',
    timeFilter: 'default-time-filter',
    sort: 'default-sort',
    bioMode: 'default-bio-mode',
  };

  function load(){
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch { return { ...DEFAULTS }; }
  }
  function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
  function isDefault(s){
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) return false;
    return true;
  }

  // ---- Unified share encoding (prefs + settings) using CompressionStream when available ----
  function b64uEncode(bytes){
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str){
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function compressJson(obj){
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === 'undefined') {
      // Fallback: plain base64 of UTF-8
      const enc = new TextEncoder().encode(json);
      return 'r' + b64uEncode(enc); // 'r' prefix = raw (uncompressed)
    }
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return 'd' + b64uEncode(bytes); // 'd' prefix = deflate-raw
  }
  async function decompressJson(str){
    if (!str) return null;
    try {
      const prefix = str[0];
      const body = str.slice(1);
      const bytes = b64uDecode(body);
      if (prefix === 'r') return JSON.parse(new TextDecoder().decode(bytes));
      if (prefix === 'd') {
        if (typeof DecompressionStream === 'undefined') return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const json = await new Response(stream).text();
        return JSON.parse(json);
      }
      return null;
    } catch { return null; }
  }

  function snapshotPrefs(){
    try {
      return typeof loadPrefs === 'function'
        ? loadPrefs()
        : (JSON.parse(localStorage.getItem('cellar-tonight-prefs')) || { faves: [], skips: [], likes: [] });
    } catch { return { faves: [], skips: [], likes: [] }; }
  }
  function writePrefs(p){
    if (typeof savePrefs === 'function') { savePrefs(p); return; }
    localStorage.setItem('cellar-tonight-prefs', JSON.stringify(p));
  }
  function buildPayload(){
    const prefs = snapshotPrefs();
    // Omit defaults from settings to keep payload small. Decoder fills in via DEFAULTS.
    const s = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (settings[k] !== DEFAULTS[k]) s[k] = settings[k];
    }
    const p = {};
    if (prefs.faves?.length) p.f = prefs.faves;
    if (prefs.skips?.length) p.s = prefs.skips;
    if (prefs.likes?.length) p.l = prefs.likes;
    const out = {};
    if (Object.keys(s).length) out.s = s;
    if (Object.keys(p).length) out.p = p;
    return out;
  }
  async function buildShareLink(){
    const payload = buildPayload();
    if (Object.keys(payload).length === 0) {
      return window.location.origin + window.location.pathname;
    }
    const compressed = await compressJson(payload);
    return window.location.origin + window.location.pathname + '#cfg=' + compressed;
  }

  // ---- Hash import: handles #cfg= (new), #p= (legacy prefs), #s= (legacy settings) ----
  // Runs synchronously at script load so the imported state flows through normal init.
  let didImport = false;
  let priorSnapshot = null;
  async function tryImportFromHash(hashStr){
    if (!hashStr) return null;
    const cfgMatch = hashStr.match(/[#&]cfg=([^&]+)/);
    const pMatch = hashStr.match(/[#&]p=([A-Za-z0-9_-]+)/);
    const sMatch = hashStr.match(/[#&]s=([^&]+)/);
    if (cfgMatch) {
      const decoded = await decompressJson(cfgMatch[1]);
      if (!decoded) return null;
      return { prefs: decoded.p, settings: decoded.s };
    }
    if (pMatch && typeof decompressPrefs === 'function') {
      try {
        const prefs = await decompressPrefs(pMatch[1]);
        return { prefs: { f: prefs.faves, s: prefs.skips, l: prefs.likes } };
      } catch { /* ignore */ }
    }
    if (sMatch) {
      // Legacy #s= was plain base64 of settings JSON
      try {
        const bytes = b64uDecode(sMatch[1]);
        const json = new TextDecoder().decode(bytes);
        return { settings: JSON.parse(json) };
      } catch { /* ignore */ }
    }
    return null;
  }

  function pickPrefsFromImport(p){
    if (!p) return null;
    return {
      faves: p.f || p.faves || [],
      skips: p.s || p.skips || [],
      likes: p.l || p.likes || [],
    };
  }

  // ---- Visual application ----
  function setFavicon(color){
    const svg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="m0 0h32v32h-32z"/><text fill="#fff" font-family="Helvetica,-apple-system,BlinkMacSystemFont,sans-serif" font-size="19" font-weight="700" text-anchor="middle" x="16" y="23">TN</text></svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    document.querySelectorAll('link[rel="icon"]').forEach(l => l.href = url);
  }
  function resetFavicon(){
    document.querySelectorAll('link[rel="icon"]').forEach(l => l.href = 'favicon.svg');
  }
  function applyAccent(s){
    document.documentElement.style.setProperty('--accent', s.accent);
    if (s.accent !== DEFAULTS.accent) setFavicon(s.accent); else resetFavicon();
  }

  // Resolve "schedule day" setting → activeDate value.
  function resolveScheduleDay(value){
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const now = new Date();
    if (value === 'today') return fmt(now);
    if (value === 'tomorrow') { const t = new Date(now); t.setDate(t.getDate()+1); return fmt(t); }
    if (value === 'weekend') {
      const d = new Date(now);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) return fmt(d);
      const daysUntilSat = (6 - dow + 7) % 7;
      d.setDate(d.getDate() + daysUntilSat);
      return fmt(d);
    }
    return 'all';
  }

  // Apply filter defaults to the live toolbar controls so the first render reflects them.
  function applyFilterDefaults(s){
    // Time filter
    const tfVisible = document.getElementById('time-filter-visible');
    const tfHidden = document.getElementById('time-filter');
    if (tfHidden && s.timeFilter) tfHidden.value = s.timeFilter;
    if (tfVisible && s.timeFilter) tfVisible.value = s.timeFilter;
    // Sort
    const sortSel = document.getElementById('sort-select');
    if (sortSel && s.sort) sortSel.value = s.sort;
    // Bio mode
    const bioSel = document.getElementById('bio-mode');
    if (bioSel && s.bioMode) bioSel.value = s.bioMode;
    // Ratings (quick-mode)
    const qm = document.getElementById('quick-mode');
    if (qm) qm.checked = s.ratingsMode === 'on';
    // Neighborhood
    if (typeof activeNeighborhood !== 'undefined' && s.neighborhood) {
      activeNeighborhood = s.neighborhood;
    }
    // Schedule day → activeDate
    if (typeof activeDate !== 'undefined' && s.scheduleDay) {
      activeDate = resolveScheduleDay(s.scheduleDay);
    }
  }

  // ---- Synchronous import → save → strip-hash, then load merged settings ----
  // (Runs in a top-level async IIFE — but we need it to complete BEFORE init resumes
  //  from its first `await`. We trigger it sync and let it set localStorage immediately
  //  on the synchronous portion via fallback when CompressionStream is unavailable;
  //  for the compressed path we rely on the loadPrefsFromHash awaited in init to
  //  read what we wrote.)
  (async function importFromHashOnLoad(){
    const hashStr = window.location.hash;
    const imported = await tryImportFromHash(hashStr);
    if (!imported) return;
    priorSnapshot = { prefs: snapshotPrefs(), settings: load() };
    if (imported.settings) {
      const merged = Object.assign({}, DEFAULTS, imported.settings);
      save(merged);
      Object.assign(settings, merged);
      applyAccent(settings);
      // If init has already mounted, re-apply filter defaults now.
      applyFilterDefaults(settings);
      // Sold-out filter dropdown:
      const soldSelNow = document.getElementById('soldout-filter');
      if (soldSelNow) soldSelNow.value = settings.soldOutMode || 'all';
      const hideCbNow = document.getElementById('hide-sold-out');
      if (hideCbNow) hideCbNow.checked = settings.soldOutMode === 'hide';
    }
    const prefs = pickPrefsFromImport(imported.prefs);
    if (prefs && (prefs.faves.length || prefs.skips.length || prefs.likes.length)) {
      writePrefs(prefs);
    }
    didImport = true;
    // Strip cfg/p/s from the hash.
    const cleaned = window.location.hash
      .replace(/[#&]?cfg=[^&]+/, '')
      .replace(/[#&]?p=[^&]+/, '')
      .replace(/[#&]?s=[^&]+/, '')
      .replace(/^#&/, '#');
    history.replaceState(null, '', window.location.pathname + (cleaned === '#' ? '' : cleaned));
    // Toast (after a tick so the modal/render is up).
    setTimeout(() => {
      showImportToast(imported);
      if (typeof renderShows === 'function') renderShows();
      if (typeof updateShareBtn === 'function') updateShareBtn();
    }, 200);
  })();

  const settings = load();
  applyAccent(settings);

  // Pre-set the venue tab before init's first render. activeSource is declared in data.js.
  if (settings.defaultTab && typeof activeSource !== 'undefined') {
    activeSource = settings.defaultTab;
  }
  applyFilterDefaults(settings);
  const soldSel = document.getElementById('soldout-filter');
  if (soldSel && settings.soldOutMode) soldSel.value = settings.soldOutMode;
  const hideCb = document.getElementById('hide-sold-out');
  if (hideCb) hideCb.checked = settings.soldOutMode === 'hide';

  // ---- DOM refs ----
  const overlay = document.getElementById('app-settings-overlay');
  const openBtn = document.getElementById('header-settings');
  const closeBtn = document.getElementById('app-settings-close');
  const doneBtn = document.getElementById('app-settings-done');
  const swatches = document.getElementById('color-swatches');
  const custom = document.getElementById('color-custom-input');
  const resetColorBtn = document.getElementById('reset-color');
  const shareBtn = document.getElementById('copy-settings-link');
  const qrBtn = document.getElementById('show-settings-qr');
  const resetAllBtn = document.getElementById('reset-all-settings');
  const importInput = document.getElementById('settings-import-url');
  const importGoBtn = document.getElementById('settings-import-go');
  const importStatus = document.getElementById('settings-import-status');
  const qrOverlay = document.getElementById('settings-qr-overlay');
  const qrCloseBtn = document.getElementById('settings-qr-close');
  const qrCanvas = document.getElementById('settings-qr-canvas');
  const qrUrlOut = document.getElementById('settings-qr-url');

  // ---- Pill / swatch refresh helpers ----
  function refreshPills(key){
    const groupId = PILL_GROUPS[key];
    if (!groupId) return;
    const group = document.getElementById(groupId);
    if (!group) return;
    const value = String(settings[key] ?? DEFAULTS[key]);
    group.querySelectorAll('.settings-pill').forEach(p => {
      p.setAttribute('aria-checked', p.dataset.value === value ? 'true' : 'false');
    });
    // Mirror into hidden select
    const mirrorId = MIRROR_SELECTS[key];
    if (mirrorId) {
      const sel = document.getElementById(mirrorId);
      if (sel) sel.value = value;
    }
  }
  function refreshSwatches(){
    if (!swatches) return;
    const cur = (settings.accent || '').toLowerCase();
    swatches.querySelectorAll('.color-swatch').forEach(b => {
      b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === cur);
    });
  }
  function refreshShareUI(){
    const show = !isDefault(settings) || hasAnyPrefs();
    if (shareBtn) {
      shareBtn.style.display = show ? '' : 'none';
      shareBtn.textContent = 'Copy my setup';
    }
    if (qrBtn) qrBtn.style.display = show ? '' : 'none';
    if (typeof updateShareBtn === 'function') updateShareBtn();
  }
  function hasAnyPrefs(){
    const p = snapshotPrefs();
    return (p.faves?.length || 0) + (p.skips?.length || 0) + (p.likes?.length || 0) > 0;
  }
  function persist(){
    save(settings);
    refreshShareUI();
  }

  function syncToolbarFromSettings(){
    // Push current settings.* into live toolbar controls + re-render.
    applyFilterDefaults(settings);
    if (soldSel) soldSel.value = settings.soldOutMode;
    if (hideCb) hideCb.checked = settings.soldOutMode === 'hide';
    // Switch venue tab + reset date when starting tab changes.
    if (typeof activeSource !== 'undefined' && settings.defaultTab) {
      activeSource = settings.defaultTab;
      if (typeof syncUrlToSource === 'function') syncUrlToSource(activeSource);
    }
    if (typeof renderSourceTabs === 'function') renderSourceTabs();
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof updateFooterInfo === 'function') updateFooterInfo();
    if (typeof updateResetBtn === 'function') updateResetBtn();
    if (typeof renderShows === 'function') renderShows();
  }

  function openSettings(){
    if (!overlay) return;
    if (custom) custom.value = settings.accent;
    Object.keys(PILL_GROUPS).forEach(refreshPills);
    refreshSwatches();
    refreshShareUI();
    if (importStatus) importStatus.textContent = '';
    if (importInput) importInput.value = '';
    overlay.classList.remove('hidden');
  }
  function closeSettings(){ overlay?.classList.add('hidden'); }

  openBtn?.addEventListener('click', openSettings);
  closeBtn?.addEventListener('click', closeSettings);
  doneBtn?.addEventListener('click', closeSettings);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });

  // ---- Brand color ----
  swatches?.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    settings.accent = btn.dataset.color;
    persist(); applyAccent(settings);
    if (custom) custom.value = settings.accent;
    refreshSwatches();
  });
  custom?.addEventListener('input', () => {
    settings.accent = custom.value;
    persist(); applyAccent(settings); refreshSwatches();
  });
  resetColorBtn?.addEventListener('click', () => {
    settings.accent = DEFAULTS.accent;
    persist(); applyAccent(settings);
    if (custom) custom.value = settings.accent;
    refreshSwatches();
  });

  // ---- Pill groups (all default-* sections) — generic handler ----
  Object.entries(PILL_GROUPS).forEach(([key, groupId]) => {
    const group = document.getElementById(groupId);
    group?.addEventListener('click', (e) => {
      const pill = e.target.closest('.settings-pill');
      if (!pill) return;
      settings[key] = pill.dataset.value;
      persist();
      refreshPills(key);
      // Live-apply the change to the home page so the user sees the effect immediately.
      syncToolbarFromSettings();
    });
  });

  // ---- Copy share link ----
  shareBtn?.addEventListener('click', async () => {
    const url = await buildShareLink();
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Copied!';
      setTimeout(() => { shareBtn.textContent = 'Copy my setup'; }, 1800);
    } catch {
      shareBtn.textContent = 'Copy failed';
      setTimeout(() => { shareBtn.textContent = 'Copy my setup'; }, 1800);
    }
  });

  // ---- QR ----
  async function loadQrLib(){
    if (window.qrcode) return window.qrcode;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  qrBtn?.addEventListener('click', async () => {
    if (!qrOverlay) return;
    qrCanvas.innerHTML = '<p style="color:var(--text-dim);text-align:center;">Generating…</p>';
    qrOverlay.classList.remove('hidden');
    try {
      const qrcode = await loadQrLib();
      const url = await buildShareLink();
      qrUrlOut.textContent = url;
      // Build QR with error-correction L for max data capacity; size 0 = auto.
      const qr = qrcode(0, 'L');
      qr.addData(url);
      qr.make();
      qrCanvas.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    } catch (e) {
      qrCanvas.innerHTML = '<p style="color:var(--accent);">Could not load QR generator.</p>';
    }
  });
  qrCloseBtn?.addEventListener('click', () => qrOverlay?.classList.add('hidden'));
  qrOverlay?.addEventListener('click', (e) => { if (e.target === qrOverlay) qrOverlay.classList.add('hidden'); });

  // ---- Import ----
  importGoBtn?.addEventListener('click', async () => {
    const raw = (importInput?.value || '').trim();
    if (!raw) return;
    // Extract hash portion from full URL or accept bare hash.
    let hashPart = raw;
    const hashIdx = raw.indexOf('#');
    if (hashIdx >= 0) hashPart = raw.slice(hashIdx);
    else if (!/^cfg=|^p=|^s=/.test(raw)) hashPart = '#' + raw;
    else hashPart = '#' + raw;
    const imported = await tryImportFromHash(hashPart);
    if (!imported) {
      if (importStatus) { importStatus.style.color = 'var(--accent)'; importStatus.textContent = 'Could not read that link.'; }
      return;
    }
    priorSnapshot = { prefs: snapshotPrefs(), settings: load() };
    let summary = [];
    if (imported.settings) {
      const merged = Object.assign({}, DEFAULTS, imported.settings);
      save(merged);
      Object.assign(settings, merged);
      applyAccent(settings);
      syncToolbarFromSettings();
      summary.push('settings');
    }
    const prefsIn = pickPrefsFromImport(imported.prefs);
    if (prefsIn && (prefsIn.faves.length || prefsIn.skips.length || prefsIn.likes.length)) {
      // Merge with existing, like the prefs modal import does.
      const current = snapshotPrefs();
      const merged = {
        faves: [...new Set([...(current.faves || []), ...prefsIn.faves])],
        skips: [...new Set([...(current.skips || []), ...prefsIn.skips])],
        likes: [...new Set([...(current.likes || []), ...prefsIn.likes])],
      };
      writePrefs(merged);
      summary.push(`${prefsIn.faves.length} faves, ${prefsIn.skips.length} skips`);
    }
    if (importStatus) {
      importStatus.style.color = 'var(--text-dim)';
      importStatus.textContent = `Imported: ${summary.join(' · ') || 'nothing'}.`;
    }
    if (importInput) importInput.value = '';
    // Refresh modal UI
    openSettings();
    if (typeof renderShows === 'function') renderShows();
    if (typeof updateShareBtn === 'function') updateShareBtn();
    showImportToast(imported);
  });

  // ---- Toast ----
  const toast = document.getElementById('settings-toast');
  const toastMsg = document.getElementById('settings-toast-msg');
  const toastUndo = document.getElementById('settings-toast-undo');
  const toastClose = document.getElementById('settings-toast-close');
  let toastTimer = null;
  function hideToast(){ toast?.classList.add('hidden'); if (toastTimer) clearTimeout(toastTimer); toastTimer = null; }
  function showImportToast(imported){
    if (!toast) return;
    const parts = [];
    if (imported.settings) parts.push('settings');
    const prefsIn = pickPrefsFromImport(imported.prefs);
    if (prefsIn && (prefsIn.faves.length || prefsIn.skips.length || prefsIn.likes.length)) parts.push('faves');
    if (parts.length === 0) return;
    toastMsg.textContent = `Applied shared ${parts.join(' + ')}.`;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  toastUndo?.addEventListener('click', () => {
    if (!priorSnapshot) { hideToast(); return; }
    save(priorSnapshot.settings);
    Object.assign(settings, priorSnapshot.settings);
    applyAccent(settings);
    syncToolbarFromSettings();
    writePrefs(priorSnapshot.prefs);
    priorSnapshot = null;
    refreshShareUI();
    if (typeof renderShows === 'function') renderShows();
    hideToast();
  });
  toastClose?.addEventListener('click', hideToast);

  // ---- Reset all ----
  resetAllBtn?.addEventListener('click', () => {
    if (!confirm('Reset all app settings to defaults? Your faves and skips are kept.')) return;
    Object.assign(settings, DEFAULTS);
    persist();
    applyAccent(settings);
    if (custom) custom.value = settings.accent;
    Object.keys(PILL_GROUPS).forEach(refreshPills);
    refreshSwatches();
    syncToolbarFromSettings();
  });

  // Initial visibility of share + qr buttons after first render.
  setTimeout(refreshShareUI, 200);

  // Expose for the share button in the header.
  window.__tonightNycBuildShareLink = buildShareLink;
  window.__tonightNycHasNonDefault = () => !isDefault(settings) || hasAnyPrefs();
})();

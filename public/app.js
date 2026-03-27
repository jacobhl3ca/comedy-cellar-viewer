// ---- Preferences (localStorage + URL hash sync) ----
const STORAGE_KEY = 'cellar-tonight-prefs';
let bookmarkToastShown = false;

function loadPrefs() {
  try {
    // URL hash takes priority (shared link)
    const hashPrefs = readHashPrefs();
    if (hashPrefs) {
      // Import from URL into localStorage, then clear hash
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hashPrefs));
      history.replaceState(null, '', window.location.pathname);
      return hashPrefs;
    }
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { faves: stored.faves || [], skips: stored.skips || [], likes: stored.likes || [] };
  } catch { return { faves: [], skips: [], likes: [] }; }
}

function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  updateHashFromPrefs(prefs);
}

// Encode prefs into URL hash
function updateHashFromPrefs(prefs) {
  if (prefs.faves.length === 0 && prefs.skips.length === 0 && prefs.likes.length === 0) {
    history.replaceState(null, '', window.location.pathname);
    return;
  }
  const params = new URLSearchParams();
  if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
  if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
  if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
  history.replaceState(null, '', '#' + params.toString());
}

// Read prefs from URL hash
function readHashPrefs() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    const faves = params.get('f') ? params.get('f').split('|') : [];
    const skips = params.get('s') ? params.get('s').split('|') : [];
    const likes = params.get('l') ? params.get('l').split('|') : [];
    if (faves.length === 0 && skips.length === 0 && likes.length === 0) return null;
    return { faves, skips, likes };
  } catch { return null; }
}

// Save-URL toast — show once per session after first fav/skip is set
function showBookmarkToast() {
  if (bookmarkToastShown) return;
  const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if ((prefs.faves?.length || 0) + (prefs.skips?.length || 0) + (prefs.likes?.length || 0) < 1) return;
  bookmarkToastShown = true;

  const toast = document.createElement('div');
  toast.className = 'bookmark-toast';
  toast.innerHTML = `
    <span>Your picks are saved in the URL — copy it to keep them!</span>
    <button class="toast-copy-btn" onclick="copyPrefsUrl(this)">Copy URL</button>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 50);
}

function copyPrefsUrl(btn) {
  const prefs = loadPrefs();
  const params = new URLSearchParams();
  if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
  if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
  if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
  const url = window.location.origin + window.location.pathname + '#' + params.toString();
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
  } else if (inFavs) {
    // Fave → Skip
    prefs.skips.push(name);
    if (window.va) window.va('event', { name: 'skip', data: { comedian: name } });
  }
  // Skip → Neutral (already removed)

  savePrefs(prefs);
}

// ---- Comedian Database (loaded from /data/comedians.json) ----
let comedianDB = [];

let localPhotoMap = {}; // filename -> extension

function localPhotoPath(name) {
  const filename = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
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

// ---- API ----
const API_URL = '/api/lineup';

function getDateRange() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDateParam(d) { return d.toISOString().split('T')[0]; }
function getDayName(d) { return d.toLocaleDateString('en-US', { weekday: 'short' }); }
function getDateLabel(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// Global headshot maps: per-venue + fallback
const comedianPhotos = {};           // legacy fallback (any source)
const comedianPhotosCellar = {};     // from Cellar API
const comedianPhotosStand = {};      // from Stand scraper

// Venue-aware photo lookup: venue-specific → NYCC DB → cross-venue → local blob → legacy
function getPhotoForVenue(name, venueSource) {
  const dbEntry = comedianDB.find(c => c.name === name);
  // 1. Venue-specific photo
  if (venueSource === 'cellar' && comedianPhotosCellar[name]) return comedianPhotosCellar[name];
  if (venueSource === 'stand' && comedianPhotosStand[name]) return comedianPhotosStand[name];
  if (venueSource === 'nycc' && dbEntry?.photo_nycc) return dbEntry.photo_nycc;
  // 2. NYCC DB fallback
  if (dbEntry?.photo_nycc) return dbEntry.photo_nycc;
  // 3. Cross-venue fallbacks
  if (comedianPhotosCellar[name]) return comedianPhotosCellar[name];
  if (comedianPhotosStand[name]) return comedianPhotosStand[name];
  if (dbEntry?.photo_stand) return dbEntry.photo_stand;
  // 4. Local blob (saved file)
  const local = localPhotoPath(name);
  if (local) return local;
  // 5. Legacy pool (Wikipedia, SeatGeek, etc.)
  return comedianPhotos[name] || '';
}

function parseShows(html, dateStr) {
  // Split by show blocks — each show starts with <div><div class="set-header">
  const blocks = html.split('<div><div class="set-header">').slice(1);
  const shows = [];

  // Extract name-to-photo and name-to-tagline mappings
  const photoMatches = [...html.matchAll(/<img src="([^"]+)"[^>]*>[\s\S]*?<span class="name">([^<]+)<\/span>/g)];
  photoMatches.forEach(m => {
    const name = m[2].trim();
    const imgUrl = m[1].startsWith('http') ? m[1] : 'https://www.comedycellar.com' + m[1];
    if (!comedianPhotosCellar[name]) comedianPhotosCellar[name] = imgUrl;
    // Also populate legacy map as fallback
    if (!comedianPhotos[name]) comedianPhotos[name] = imgUrl;
  });
  // Taglines: text after </span> inside the <p> that contains the name
  const tagMatches = [...html.matchAll(/<span class="name">([^<]+)<\/span>\s*(.*?)<\/p>/g)];
  tagMatches.forEach(m => {
    const name = m[1].trim();
    let tagline = m[2].trim().replace(/^,\s*/, '').replace(/<[^>]+>/g, '').trim();
    if (tagline && !comedianTaglines[name] && !isGenericBio(tagline)) {
      comedianTaglines[name] = toProperCase(tagline);
    }
  });

  blocks.forEach(block => {
    const timeMatch = block.match(/<span class="bold">(.*?)<span/);
    const venueMatch = block.match(/<span class="title">(.*?)<\/span>/);
    const linkMatch = block.match(/href="(\/reservations-newyork\/\?showid=\d+)"/);
    const names = [...block.matchAll(/<span class="name">(.*?)<\/span>/g)].map(m => normalizeName(m[1]));

    const time = timeMatch ? timeMatch[1].trim() : '';
    const venue = venueMatch ? venueMatch[1].trim() : '';
    const reserveUrl = linkMatch
      ? 'https://www.comedycellar.com' + linkMatch[1] + '&date=' + dateStr
      : '';

    if (time) {
      shows.push({ time, venue, comedians: names, reserveUrl });
    }
  });

  return shows;
}

// ---- Name normalization (fix API inconsistencies) ----
const NAME_FIXES = {
  'Will Sylvince': 'Wil Sylvince',
  'Wil Sylvince': 'Wil Sylvince',
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

// Normalize display time to "6:45 PM" format (uppercase AM/PM, no "show" suffix)
function formatTime(timeStr) {
  if (!timeStr) return 'TBD';
  const m = timeStr.match(/(\d+:\d+)\s*(am|pm)/i);
  if (!m) return timeStr;
  return m[1] + ' ' + m[2].toUpperCase();
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

// ---- Fetch with timeout ----
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ---- Fetch ----
async function fetchDay(dateStr) {
  try {
    const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({
      date: dateStr, venue: 'newyork', type: 'lineup'
    }))}`;

    const resp = await fetchWithTimeout(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    }, 15000);

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
    const resp = await fetchWithTimeout('/api/the-stand', {}, 15000);
    const data = await resp.json();
    standShows = data.shows || [];
    // Extract comedian photos from Stand data into venue-specific map
    standShows.forEach(show => {
      if (show.comedianPhotos) {
        Object.entries(show.comedianPhotos).forEach(([name, url]) => {
          if (url) {
            if (!comedianPhotosStand[name]) comedianPhotosStand[name] = url;
            if (!comedianPhotos[name]) comedianPhotos[name] = url;
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
    const resp = await fetchWithTimeout('/api/nycc', {}, 15000);
    const data = await resp.json();
    nyccShows = data.shows || [];
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

  let html = '<div class="schedule-view">';
  html += '<h2 class="schedule-day-header">NY Comedy Club</h2>';
  nyccShows.forEach(show => {
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
    const resp = await fetchWithTimeout('/api/gotham', {}, 15000);
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
    const resp = await fetchWithTimeout('/api/big-shows', {}, 15000);
    const data = await resp.json();
    bigShows = data.events || [];
    return bigShows;
  } catch (e) {
    console.error('Failed to fetch big shows:', e);
    return [];
  }
}

// ---- State ----
let allData = {};
let activeDate = null;
let dates = [];
let allComediansSeen = new Set();
let activeVenue = 'all'; // venue filter
let activeStandRoom = 'all'; // Stand room filter
let activeSource = 'all'; // venue source tab — default to All Venues

// ---- Render ----
function renderTabs() {
  const nav = document.getElementById('day-tabs');
  nav.innerHTML = '';

  nav.style.display = '';

  // "Full Schedule" tab first (far left)
  const allTab = document.createElement('button');
  allTab.className = 'day-tab' + (activeDate === 'all' ? ' active' : '');
  allTab.innerHTML = `<span class="tab-day">Full</span><span class="tab-date">Schedule</span>`;
  allTab.addEventListener('click', () => {
    activeDate = 'all';
    renderTabs();
    renderShows();
  });
  nav.appendChild(allTab);

  if (activeSource === 'the-stand') {
    // The Stand has its own date grouping
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `
        <span class="tab-day">${getDayName(d)}</span>
        <span class="tab-date">${getDateLabel(d)}</span>
      `;
      tab.addEventListener('click', () => {
        activeDate = activeDate === dateStr ? 'all' : dateStr;
        renderTabs();
        renderShows();
      });
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
      tab.addEventListener('click', () => { activeDate = activeDate === dateStr ? 'all' : dateStr; renderTabs(); renderShows(); });
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
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>`;
      tab.addEventListener('click', () => { activeDate = activeDate === dateStr ? 'all' : dateStr; renderTabs(); renderShows(); });
      nav.appendChild(tab);
    });
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const tab = document.createElement('button');
    const shows = allData[dateStr];
    const noLineup = !shows || shows.length === 0;
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    const maxScore = shows ? Math.max(0, ...shows.map(s => { const sc = scoreShow(s); return sc.faves + sc.likes; })) : 0;
    const maxFavs = shows ? Math.max(0, ...shows.map(s => scoreShow(s).faves)) : 0;

    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
      ${maxFavs >= 2 ? `<span class="tab-badge">${maxFavs} faves</span>` : (maxScore >= 2 ? `<span class="tab-badge">${maxScore} picks</span>` : '')}
    `;

    tab.addEventListener('click', () => {
      activeDate = activeDate === dateStr ? 'all' : dateStr;
      renderTabs();
      renderShows();
    });
    nav.appendChild(tab);
  });
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

function renderShows() {
  const container = document.getElementById('shows-container');

  // Route to correct renderer based on active source
  if (activeSource === 'the-stand') {
    renderTheStandShows(container);
    renderBottomTabs();
    return;
  }
  if (activeSource === 'big-shows') {
    renderBigShows(container);
    return;
  }
  if (activeSource === 'all') {
    renderAllVenues(container);
    renderBottomTabs();
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
    return;
  }


  // "All" schedule view — show all days
  if (activeDate === 'all') {
    renderAllDaysSchedule(container);
    renderBottomTabs();
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

  // Show onboarding banner if no prefs set
  if (!hasAnyPrefs && !localStorage.getItem('onboard-dismissed')) {
    html += `
      <div class="onboard-banner" id="onboard-banner">
        <p><strong>New here?</strong> Tap comedian names to mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
        <button class="onboard-btn" onclick="openModal()">Set Up</button>
        <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
      </div>
    `;
  }

  html += sorted.map(show => renderShowCard(show, hideSkips, onlyFavs)).join('');

  container.innerHTML = html;

  // Render bottom nav tabs
  renderBottomTabs();
}

// ---- Shared show card renderer ----
function renderShowCard(show, hideSkips, onlyFavs) {
  try {
  // Venue filter (compare against normalized venue name)
  if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return '';

  // Time filter (range)
  const timeFilter = document.getElementById('time-filter')?.value;
  const timeFilterMin = window._timeFilterMin;
  const showTime24_tf = to24h(show.time);
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

  const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';

  // Detect named/special shows vs plain venue variants
  const normalizedVenue = normalizeVenue(show.venue);
  const venueStart = show.venue.toLowerCase();
  const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');

  return `
    <div class="${cardClass}">
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
          ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Reserve</a>`
          : '<span></span>'}
        <span class="fav-count">
          ${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}
                 </span>
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
    let prefix = '';

    if (favd) {
      cls += ' fav';
      prefix = '<span class="star">⭐</span>';
    } else if (liked) {
      // Legacy likes treated as faves
      cls += ' fav';
      prefix = '<span class="star">⭐</span>';
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
    const photoHtml = (showPhotos && photoUrl)
      ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">`
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
      if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return;
      const stats = scoreShow(show);
      if (onlyFavs && stats.faves === 0 && stats.likes === 0) return;
      // Hide entire show if any comedian is a skip
      if (hideSkips && stats.skips > 0) return;
      const timeFilter = document.getElementById('time-filter')?.value;
      const timeFilterMin2 = window._timeFilterMin;
      const showTime24_sf = to24h(show.time);
      if (timeFilter && timeFilter !== 'any' && showTime24_sf && showTime24_sf > timeFilter) return;
      if (timeFilterMin2 && showTime24_sf && showTime24_sf < timeFilterMin2) return;
      allShows.push({ ...show, dateStr, dateObj: d, faves: stats.faves, score: stats.score, stats });
    });
  });

  // Sort by weighted score (faves*2 - skips), then by fave count
  allShows.sort((a, b) => b.score - a.score || b.faves - a.faves);

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
    const dayLabel = show.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (show.dateStr !== lastDateStr) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDateStr = show.dateStr;
    }

    const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';
    let badge = '';
    if (stats.faves >= 3) badge = `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
    else if (stats.faves >= 2) badge = `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;
    if (stats.likes > 0) badge += ` <span class="show-badge badge-likes">${stats.likes} LIKE${stats.likes > 1 ? 'S' : ''}</span>`;

    const normalizedVenue = normalizeVenue(show.venue);
    const venueStart = show.venue.toLowerCase();
    const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
    const chips = renderComedianChips(show.comedians, hideSkips, 'cellar');

    html += `
      <div class="${cardClass}">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span>${badge}</div>
          ${!isPlainVenue ? (getCellarPoster(show.venue) ? `<span class="show-name poster-wrap">Comedy Cellar: ${show.venue}<img class="poster-preview" src="${getCellarPoster(show.venue)}" alt="${show.venue}"></span>` : `<span class="show-name">Comedy Cellar: ${show.venue}</span>`) : '<span class="show-name">Comedy Cellar</span>'}
          <span class="show-venue">${normalizedVenue}</span>
        </div>
        <div class="show-lineup">${chips}</div>
        <div class="show-footer">
          ${show.reserveUrl ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Reserve</a>` : '<span></span>'}
          <span class="fav-count">${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''} ${stats.likes > 0 ? `👍 ${stats.likes}` : ''}</span>
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
  if (!hasAnyPrefs2 && !localStorage.getItem('onboard-dismissed')) {
    html += `
      <div class="onboard-banner" id="onboard-banner">
        <p><strong>New here?</strong> Tap comedian names to mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
        <button class="onboard-btn" onclick="openModal()">Set Up</button>
        <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
      </div>
    `;
  }
  html += '<div class="schedule-view">';

  // For The Stand, iterate over stand show dates
  if (activeSource === 'the-stand') {
    const timeFilterStand = document.getElementById('time-filter')?.value;
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      let dayShows = standShows.filter(s => s.date === dateStr);
      if (activeStandRoom !== 'all') {
        dayShows = dayShows.filter(s => {
          const r = s.room ? s.room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim() : 'Main';
          return r === activeStandRoom;
        });
      }
      if (timeFilterStand && timeFilterStand !== 'any') {
        dayShows = dayShows.filter(s => {
          const t24 = to24h(s.time);
          return !t24 || t24 <= timeFilterStand;
        });
      }
      const tfMinStand = window._timeFilterMin;
      if (tfMinStand) {
        dayShows = dayShows.filter(s => { const t24 = to24h(s.time); return !t24 || t24 >= tfMinStand; });
      }
      if (dayShows.length === 0) {
        html += '<div class="no-shows" style="padding:16px 0;">No shows.</div>';
        return;
      }
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
    const shows = allData[dateStr];
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;

    if (!shows || shows.length === 0) {
      const dow = d.getDay();
      let hint = '';
      if (dow >= 1 && dow <= 4) hint = 'Weekday lineups usually drop the day before.';
      else hint = 'Weekend lineups usually post Thursday.';
      html += `<div class="no-shows" style="padding:16px 0;">No lineup posted.${hint ? `<br><span style="font-size:12px;color:var(--text-dim)">${hint}</span>` : ''}</div>`;
      return;
    }

    let sorted = shows;
    if (shouldSort) sorted = [...shows].sort((a, b) => scoreShow(b).score - scoreShow(a).score || scoreShow(b).faves - scoreShow(a).faves);

    sorted.forEach(show => {
      try {
      if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return;
      if (timeFilterCellar && timeFilterCellar !== 'any') {
        const t24 = to24h(show.time);
        if (t24 && t24 > timeFilterCellar) return;
      }
      { const tfMinC = window._timeFilterMin; if (tfMinC) { const t24 = to24h(show.time); if (t24 && t24 < tfMinC) return; } }
      const stats = scoreShow(show);
      if (onlyFavs && stats.faves === 0 && stats.likes === 0) return;
      // Hide entire show if any comedian is a skip
      if (document.getElementById('hide-skips').checked && stats.skips > 0) return;
      const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';
      let badge = '';
      if (stats.faves >= 3) badge = `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
      else if (stats.faves >= 2) badge = `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;

      const showPhotos = document.getElementById('show-photos')?.checked ?? true;
      const chips = renderComedianChips(show.comedians, document.getElementById('hide-skips').checked, 'cellar');

      html += `
        <div class="${cardClass} schedule-card">
          <div class="show-header">
            <div><span class="show-time">${formatTime(show.time)}</span>${badge}</div>
            <span class="show-venue">${show.venue}</span>
          </div>
          <div class="show-lineup">${chips}</div>
          <div class="show-footer">
            ${show.reserveUrl ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Reserve</a>` : '<span></span>'}
            <span class="fav-count">${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''} ${stats.likes > 0 ? `👍 ${stats.likes}` : ''}</span>
          </div>
        </div>`;
      } catch (e) { console.error('renderAllDaysSchedule Cellar card error:', e, show); }
    });
  });

  html += '</div>';
  container.innerHTML = html;
}

// ---- Stand room filter ----
function renderStandRoomFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'the-stand') return;

  // Get unique rooms from Stand shows
  const rooms = [...new Set(standShows.map(s => {
    const r = s.room ? s.room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim() : '';
    return r || 'Main';
  }))].sort();

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
    const isPresents = /^The Stand Presents/i.test(t);
    // Check if title is just a comedian's name from the lineup
    const isComedianName = show.comedians.some(c => t.toLowerCase() === c.toLowerCase());
    if (!isPresents && !isComedianName && t.toLowerCase() !== 'the stand') {
      showLabel = 'The Stand: ' + t;
    }
  }

  const room = show.room ? show.room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '') : '';
  // Shorten room names and capitalize properly
  let shortRoom = room.replace(/^The Stand\s*/i, '').trim();
  // Capitalize each word
  shortRoom = shortRoom.replace(/\b\w/g, c => c.toUpperCase());
  const venueText = shortRoom || 'The Stand';

  // Poster hover
  const posterHtml = show.poster
    ? `<span class="show-name poster-wrap">${showLabel}<img class="poster-preview" src="${show.poster}" alt="${showLabel}"></span>`
    : `<span class="show-name">${showLabel}</span>`;

  return `
    <div class="show-card">
      <div class="show-header">
        <div><span class="show-time">${formatTime(show.time)}</span></div>
        ${posterHtml}
        <span class="show-venue">${venueText}</span>
      </div>
      <div class="show-lineup">${chips}</div>
      <div class="show-footer">
        ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
        <span class="fav-count"></span>
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

  let filtered = activeDate === 'all' ? gothamShows : gothamShows.filter(s => s.date === activeDate);

  let html = '<div class="schedule-view">';
  let lastDate = '';
  filtered.forEach(show => {
    try {
    if (show.date !== lastDate) {
      const d = new Date(show.date + 'T12:00:00');
      html += `<h2 class="schedule-day-header">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h2>`;
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

  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  // Show onboarding if no prefs
  const prefsAV = loadPrefs();
  const hasPrefsAV = prefsAV.faves.length > 0 || prefsAV.skips.length > 0 || prefsAV.likes.length > 0;

  // Collect ALL shows into one list with date + sort key
  let allItems = [];

  // Cellar shows
  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    if (!shows) return;
    shows.forEach(show => {
      const time24 = to24h(show.time) || '00:00';
      allItems.push({ type: 'cellar', dateStr, time24, show });
    });
  });

  // Stand shows
  standShows.forEach(show => {
    const time24 = to24h(show.time) || '00:00';
    allItems.push({ type: 'stand', dateStr: show.date, time24, show });
  });

  // Gotham shows
  gothamShows.forEach(show => {
    const time24 = to24h(show.time) || '00:00';
    allItems.push({ type: 'gotham', dateStr: show.date, time24, show });
  });

  // Big Shows
  bigShows.forEach(evt => {
    const time24 = to24h(evt.time) || '00:00';
    allItems.push({ type: 'big', dateStr: evt.date, time24, show: evt });
  });

  // Filter by selected date if not "all"
  if (activeDate && activeDate !== 'all') {
    allItems = allItems.filter(item => item.dateStr === activeDate);
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
  if (!hasPrefsAV && !localStorage.getItem('onboard-dismissed')) {
    html += `<div class="onboard-banner"><p><strong>New here?</strong> Tap comedian names to mark favorites or skips. Or use "My Comedians" to set them all at once.</p><button class="onboard-btn" onclick="openModal()">Set Up</button><button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button></div>`;
  }
  html += '<div class="schedule-view">';
  let lastDate = '';

  allItems.forEach(item => {
    try {
    if (item.dateStr !== lastDate) {
      const d = new Date(item.dateStr + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDate = item.dateStr;
    }

    if (item.type === 'cellar') {
      html += renderShowCard(item.show, hideSkips, false);
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
      // Performer photo — SeatGeek first, local/DB fallback
      let evtPhoto = '';
      if (evt.performerImages) {
        evtPhoto = Object.values(evt.performerImages)[0] || '';
      }
      if (!evtPhoto) evtPhoto = getPhotoForVenue(evt.title, 'cellar') || localPhotoPath(evt.title) || comedianPhotos[evt.title] || '';
      const evtPhotoHtml = evtPhoto ? `<img class="comedian-photo" src="${evtPhoto}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-right:8px;">` : '';
      html += `
        <div class="big-show-card">
          <div class="show-header">
            <div><span class="show-time">${formatTime(evt.time)}</span></div>
            <span class="show-name">${evt.title}</span>
            <span class="show-venue">${evt.venue || ''}</span>
          </div>
          <div class="big-show-info" style="padding:10px 16px;display:flex;align-items:center;gap:8px;">
            ${evtPhotoHtml}
            ${evt.price ? `<span class="big-show-price">From $${evt.price}</span>` : ''}
            ${evt.url ? `<a href="${evt.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Get Tickets</a>` : ''}
          </div>
        </div>`;
    }
    } catch (e) { console.error('renderAllVenues card error:', e, item); }
  });

  html += '</div>';
  container.innerHTML = html;
}

let activeBigVenue = 'all';

function renderBigShowVenueFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'big-shows') return;
  const venues = [...new Set([...bigShows.map(e => e.venue), ...gothamShows.map(() => 'Gotham Comedy Club')].filter(Boolean))].sort();
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
  let filtered = activeDate === 'all' ? bigShows : bigShows.filter(e => e.date === activeDate);
  if (activeBigVenue !== 'all') {
    filtered = filtered.filter(e => e.venue === activeBigVenue);
  }

  // Store SeatGeek performer images in global map
  filtered.forEach(evt => {
    if (evt.performerImages) {
      Object.entries(evt.performerImages).forEach(([name, url]) => {
        if (!comedianPhotos[name]) comedianPhotos[name] = url;
      });
    }
  });

  // Group by performer/title for compact view
  const byPerformer = {};
  filtered.forEach(evt => {
    const key = evt.title || 'Unknown';
    if (!byPerformer[key]) byPerformer[key] = { events: [], venue: evt.venue, performers: evt.performers, performerImages: evt.performerImages };
    byPerformer[key].events.push(evt);
  });

  let html = '<div class="big-shows-section">';
  // Gotham: commented out — SquadUp API blocked by Cloudflare, needs Puppeteer
  // gothamShows would be merged here when working

  if (activeDate === 'all') html += '<h2 class="big-shows-header">Other Shows — Upcoming NYC Comedy</h2>';

  Object.entries(byPerformer).forEach(([title, data]) => {
    try {
    const firstEvt = data.events[0];
    // Performer photo — SeatGeek first (usually good), local/DB fallback
    let photoUrl = '';
    if (data.performerImages) {
      photoUrl = Object.values(data.performerImages)[0] || '';
    }
    if (!photoUrl) photoUrl = getPhotoForVenue(title, 'cellar') || localPhotoPath(title) || comedianPhotos[title] || '';
    const photoHtml = photoUrl ? `<img src="${photoUrl}" alt="${title}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">` : '';

    // Date boxes for each show
    const dateBoxes = data.events.map(evt => {
      const d = new Date(evt.date + 'T12:00:00');
      const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const shortDay = d.toLocaleDateString('en-US', { weekday: 'short' });
      const timeStr = evt.time || '';
      const priceStr = evt.price ? `$${evt.price}` : '';
      return evt.url
        ? `<a href="${evt.url}" target="_blank" class="big-date-box" onclick="trackReserve(this)"><span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span>${priceStr ? `<span class="bdb-price">${priceStr}</span>` : ''}</a>`
        : `<span class="big-date-box"><span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span></span>`;
    }).join('');

    html += `
      <div class="big-show-card">
        <div class="big-show-info" style="display:flex;gap:12px;align-items:flex-start;">
          ${photoHtml}
          <div style="flex:1;min-width:0;">
            <div class="big-show-title">${title}</div>
            <div class="big-show-meta"><span class="big-show-venue">${data.venue}</span></div>
            <div class="big-date-boxes">${dateBoxes}</div>
          </div>
        </div>
      </div>`;
    } catch (e) { console.error('renderBigShows card error:', e, title); }
  });

  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
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
  allTab.addEventListener('click', () => {
    activeDate = 'all';
    renderTabs();
    renderShows();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
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
      tab.addEventListener('click', () => {
        activeDate = dateStr;
        renderTabs();
        renderShows();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
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
      tab.addEventListener('click', () => { activeDate = dateStr; renderTabs(); renderShows(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      nav.appendChild(tab);
    });
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    const noLineup = !shows || shows.length === 0;
    const tab = document.createElement('button');
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
    `;
    tab.addEventListener('click', () => {
      activeDate = dateStr;
      renderTabs();
      renderShows();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
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
  if (activeSource === 'the-stand') panelVenueSource = 'stand';
  else if (activeSource === 'all' && showCard) {
    const venueEl = showCard.querySelector('.show-venue');
    const venueText = venueEl?.textContent?.toLowerCase() || '';
    if (venueText.includes('stand')) panelVenueSource = 'stand';
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
  Object.values(allData).forEach(dayShows => dayShows.forEach(show => show.comedians.forEach(n => cellarComedianNames.add(n))));
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
  panel.innerHTML = `
    ${dbPhoto ? `<img src="${dbPhoto}" alt="${name}">` : ''}
    <div class="exp-info">
      <div class="exp-name">${name}</div>
      ${fullBio ? `<div class="exp-tagline">${fullBio}</div>` : ''}
      ${venues ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Also at: ${venues}</div>` : ''}
      <div class="exp-actions">
        <button class="exp-btn ${isFavd ? 'is-fav' : ''}" onclick="setPref('${esc}','fav')">
          ${isFavd ? '⭐ Favorited' : '☆ Favorite'}
        </button>
        <button class="exp-btn ${isNeutral ? 'is-neutral' : ''}" onclick="setPref('${esc}','neutral')">
          ${isNeutral ? '● Neutral' : '○ Neutral'}
        </button>
        <button class="exp-btn ${isSkipd ? 'is-skip' : ''}" onclick="setPref('${esc}','skip')">
          ${isSkipd ? '✕ Skipped' : '— Skip'}
        </button>
        <button class="exp-btn ${alerted ? 'is-alert' : ''}" onclick="toggleAlertBtn('${esc}', this)">
          ${alerted ? '🔔 Alerted' : '🔕 Alert me'}
        </button>
      </div>
    </div>
  `;
  // Append at end of lineup (before reserve/footer), not after clicked card
  container.appendChild(panel);
}

function toggleAlertBtn(name, btn) {
  // Prompt for email on first alert if not set
  if (!isAlerted(name) && !getAlertEmail()) {
    const email = prompt('Enter your email to get notified when this comedian is performing:');
    if (!email || !email.includes('@')) return;
    setAlertEmail(email.trim());
  }
  toggleAlert(name);
  const alerted = isAlerted(name);
  btn.className = 'exp-btn' + (alerted ? ' is-alert' : '');
  btn.textContent = alerted ? '🔔 Alerted' : '🔕 Alert me';
}

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

// ---- Modal ----
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderModal();
  if (window.va) window.va('event', { name: 'modal_open' });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  showBookmarkToast();
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
    html += `<h3 class="modal-section-title" style="margin-top:16px;">Other Shows</h3>`;
    html += `<div class="chip-list">${otherSorted.map(chipHtml).join('')}</div>`;
  }
  allList.innerHTML = html;
}

function modalCycle(name) {
  const prevPrefs = loadPrefs();
  const hadAny = prevPrefs.faves.length > 0 || prevPrefs.skips.length > 0;
  cycleComedian(name);
  const newPrefs = loadPrefs();
  const hasAny = newPrefs.faves.length > 0 || newPrefs.skips.length > 0;
  // Show onboarding hint after first selection
  if (!hadAny && hasAny) {
    const hint = document.getElementById('modal-onboard-hint');
    if (hint) hint.style.display = 'block';
  }
  const search = document.getElementById('comedian-search').value;
  renderModal(search);
}

// ---- Reset filters visibility ----
function updateResetBtn() {
  const btn = document.getElementById('reset-filters');
  if (!btn) return;
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
    !!window._timeFilterMin;
  btn.style.display = anyActive ? 'inline-block' : 'none';
  const resetRow = document.getElementById('toolbar-reset-row');
  if (resetRow) resetRow.style.display = anyActive ? 'flex' : 'none';
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

// ---- Tagline helpers ----
const comedianTaglines = {};       // Cellar API taglines (live)
const comedianWikiBios = {};       // Wikipedia bios (last resort)

// Venue-aware bio lookup: Cellar tagline → Stand DB bio → NYCC DB bio → Wikipedia → ''
function getBioForVenue(name, venueSource) {
  // 1. If Cellar show, prefer Cellar live tagline
  if (venueSource === 'cellar') {
    const cellarTag = comedianTaglines[name];
    if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
  }
  // 2. If Stand show, prefer Stand bio from DB
  if (venueSource === 'stand') {
    const dbEntry = comedianDB.find(c => c.name === name);
    if (dbEntry?.bio_stand && !isGenericBio(dbEntry.bio_stand)) return dbEntry.bio_stand;
  }
  // 3. NYCC bio from DB (works for any venue as fallback)
  const dbEntry = comedianDB.find(c => c.name === name);
  if (dbEntry?.bio && !isGenericBio(dbEntry.bio)) return dbEntry.bio;
  // 4. Cellar tagline as fallback for non-Cellar shows too
  const cellarTag = comedianTaglines[name];
  if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
  // 5. Wikipedia (last resort)
  const wiki = comedianWikiBios[name];
  if (wiki && !isGenericBio(wiki)) return wiki;
  return '';
}

function isGenericBio(bio) {
  if (!bio) return true;
  const lower = bio.toLowerCase();
  // Reject bios that are just "[Name] is a stand-up comedian" + generic filler
  if (/^[a-z\s.'-]+ is a (stand-up )?comedian/.test(lower) &&
      (/performs regularly on the/.test(lower) || /regular (at|on) the (nyc|new york|comedy) (comedy )?scene/.test(lower) ||
       /known for (his|her|their) (unique|sharp|fresh|energetic)/.test(lower))) return true;
  // Reject very short generic descriptions
  if (bio.length < 40 && /is a (stand-up )?comedian/.test(lower)) return true;
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
  console.log(`Reserve click #${count}:`, el?.href);
}

// ---- Close info popups on click outside ----
document.addEventListener('click', (e) => {
  if (!e.target.closest('.info-icon')) {
    document.querySelectorAll('.info-popup.visible').forEach(p => p.classList.remove('visible'));
  }
});

// ---- Init ----
async function init() {
  dates = getDateRange();
  activeDate = 'all';

  // Fetch all sources in parallel (all have timeouts so page won't hang forever)
  const [cellarResults] = await Promise.all([
    Promise.all(dates.map(d => fetchDay(formatDateParam(d)))),
    fetchTheStand(),
    fetchBigShows(),
    fetchNYCC(),
    loadComedianDB(),
    fetchGotham()
  ]);

  dates.forEach((d, i) => {
    const dateStr = formatDateParam(d);
    allData[dateStr] = cellarResults[i];
    if (cellarResults[i]) {
      cellarResults[i].forEach(show => {
        show.comedians.forEach(name => allComediansSeen.add(name));
      });
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

  document.getElementById('loading').style.display = 'none';
  // Default to big picture mode
  const pmEl = document.getElementById('picture-mode');
  if (pmEl && !pmEl.checked) pmEl.checked = true;
  initTheme();
  renderSourceTabs();
  renderTabs();
  renderShows();
  updateFooterInfo();
  document.getElementById('schedule-filter-area')?.classList.add('ready');

  // Enrich bios from Wikipedia in background (don't block render)
  enrichBiosFromWikipedia().then(() => {
    // Re-render to show new bios if user has bios toggled on
    if (document.getElementById('expand-bios')?.checked || document.getElementById('expand-long-bios')?.checked) {
      renderShows();
    }
  });

  // Venue source tab listeners
  document.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const prevDate = activeDate;
      // Unselect: clicking active source goes back to All Venues
      const newSource = btn.dataset.source;
      activeSource = (newSource === activeSource && newSource !== 'all') ? 'all' : newSource;
      activeVenue = 'all';
      activeStandRoom = 'all';
      // Preserve selected date across tabs if that date exists in new source
      if (prevDate && prevDate !== 'all') {
        activeDate = prevDate;
      } else {
        activeDate = 'all';
      }
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
    const sp = document.getElementById('show-photos'); if (sp) sp.checked = true;
    const tf = document.getElementById('time-filter');
    if (tf) tf.value = 'any';
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
  document.getElementById('comedian-search').addEventListener('input', e => {
    renderModal(e.target.value);
  });
  document.getElementById('reset-prefs').addEventListener('click', () => {
    if (confirm('Reset all favorites and skips?')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ faves: [], skips: [], likes: [] }));
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('comedian-search').value = '';
      renderModal();
      renderTabs();
    }
  });

  // "Filters" dropdown toggle
  const filtersBtn = document.getElementById('filters-toggle');
  const filtersPanel = document.getElementById('filters-panel');
  if (filtersBtn && filtersPanel) {
    filtersBtn.addEventListener('click', () => {
      const visible = filtersPanel.style.display !== 'none';
      filtersPanel.style.display = visible ? 'none' : 'block';
      filtersBtn.textContent = visible ? 'Filters ▾' : 'Filters ▴';
      filtersBtn.classList.toggle('active', !visible);
    });
  }

  document.getElementById('share-link').addEventListener('click', () => {
    const prefs = loadPrefs();
    const params = new URLSearchParams();
    if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
    if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
    if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
    const url = window.location.origin + window.location.pathname + '#' + params.toString();
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('share-link');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Share Link'; }, 2000);
    });
  });
}

init();

// Back to top button
(function() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

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
window.trackReserve = trackReserve;

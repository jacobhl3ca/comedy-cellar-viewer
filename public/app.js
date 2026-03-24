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
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { faves: [], skips: [] };
  } catch { return { faves: [], skips: [] }; }
}

function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  updateHashFromPrefs(prefs);
  showBookmarkToast();
}

// Encode prefs into URL hash
function updateHashFromPrefs(prefs) {
  if (prefs.faves.length === 0 && prefs.skips.length === 0) {
    history.replaceState(null, '', window.location.pathname);
    return;
  }
  const params = new URLSearchParams();
  if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
  if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
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
    if (faves.length === 0 && skips.length === 0) return null;
    return { faves, skips };
  } catch { return null; }
}

// Save-URL toast — show once per session after first fav/skip is set
function showBookmarkToast() {
  if (bookmarkToastShown) return;
  const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if ((prefs.faves?.length || 0) + (prefs.skips?.length || 0) < 1) return;
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
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 8000);
}

function copyPrefsUrl(btn) {
  const prefs = loadPrefs();
  const params = new URLSearchParams();
  if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
  if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
  const url = window.location.origin + window.location.pathname + '#' + params.toString();
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy URL'; }, 2000);
  });
}

function isFav(name) { return loadPrefs().faves.includes(name); }
function isSkip(name) { return loadPrefs().skips.includes(name); }

function cycleComedian(name) {
  const prefs = loadPrefs();
  const inFavs = prefs.faves.includes(name);
  const inSkips = prefs.skips.includes(name);

  // Cycle: neutral -> fav -> skip -> neutral
  prefs.faves = prefs.faves.filter(n => n !== name);
  prefs.skips = prefs.skips.filter(n => n !== name);

  if (!inFavs && !inSkips) {
    prefs.faves.push(name);
  } else if (inFavs) {
    prefs.skips.push(name);
  }
  // if inSkips, we already removed it — back to neutral

  savePrefs(prefs);
}

// ---- Comedian Database (loaded from /data/comedians.json) ----
let comedianDB = [];

async function loadComedianDB() {
  try {
    const resp = await fetch('/data/comedians.json');
    comedianDB = await resp.json();
    // Merge photos and bios from DB into runtime maps
    comedianDB.forEach(c => {
      const photo = c.photo_stand || c.photo_nycc;
      if (photo && !comedianPhotos[c.name]) comedianPhotos[c.name] = photo;
      if (c.bio && !comedianTaglines[c.name]) comedianTaglines[c.name] = c.bio;
    });
  } catch (e) {
    console.error('Failed to load comedian DB:', e);
  }
}

// ---- Alerts (localStorage-based MVP) ----
const ALERTS_KEY = 'cellar-tonight-alerts';

function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(ALERTS_KEY)) || { email: '', comedians: [] }; }
  catch { return { email: '', comedians: [] }; }
}

function saveAlerts(alerts) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
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

// ---- Comedy Cellar Regulars ----
const CELLAR_REGULARS = new Set([
  'James Mattern', 'Janelle James', 'Eric Neumann', 'Dan Naturman', 'Dov Davidoff',
  'Erin Jackson', 'Winston Hodges', 'Todd Barry', 'Ryan Hamilton', 'Yamaneika Saunders',
  'Lynne Koplitz', 'Dave Attell', 'Brendan Sagalow', 'Jon Laster', 'Greg Stone',
  'Daniel Simonsen', 'Caitlin Peluffo', 'Rich Aronovitch', 'Lev Fer', 'T.J. Miller',
  'Colin Quinn', 'Regina DeCicco', 'Liza Treyger', 'Nick Griffin', 'Cipha Sounds',
  'Ethan Simmons-Patterson', 'Alex Kumin', 'Robert Kelly', 'Judah Friedlander',
  'Jared Freid', 'Greer Barnes', 'Aaron Chen', 'Andrew Schulz', 'Anthony Devito',
  'Leonard Ouzts', 'Michael Rowland', 'Eagle Witt', 'Drew Dunn', 'Seaton C. Smith',
  'Sydnee Washington', 'Simeon Goodson', 'Ryan Reiss', 'Mike Yard', 'Shaun Murphy',
  'Gregg Rogell', 'Hot Soup', 'Ardie Fuqua', 'LeClerc Andre', 'Alex English',
  'Are You Garbage', 'H.Foley', 'Kevin Ryan', 'Jamie Wolf'
]);

function isRegular(name) { return CELLAR_REGULARS.has(name); }

// ---- API ----
const API_URL = '/api/lineup';

function getDateRange() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDateParam(d) { return d.toISOString().split('T')[0]; }
function getDayName(d) { return d.toLocaleDateString('en-US', { weekday: 'short' }); }
function getDateLabel(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// Global headshot map: name -> image URL
const comedianPhotos = {};

function parseShows(html, dateStr) {
  // Split by show blocks — each show starts with <div><div class="set-header">
  const blocks = html.split('<div><div class="set-header">').slice(1);
  const shows = [];

  // Extract name-to-photo and name-to-tagline mappings
  const photoMatches = [...html.matchAll(/<img src="([^"]+)"[^>]*>[\s\S]*?<span class="name">([^<]+)<\/span>/g)];
  photoMatches.forEach(m => {
    const imgUrl = m[1].startsWith('http') ? m[1] : 'https://www.comedycellar.com' + m[1];
    comedianPhotos[m[2].trim()] = imgUrl;
  });
  // Taglines: text after </span> inside the <p> that contains the name
  const tagMatches = [...html.matchAll(/<span class="name">([^<]+)<\/span>\s*(.*?)<\/p>/g)];
  tagMatches.forEach(m => {
    const name = m[1].trim();
    let tagline = m[2].trim().replace(/^,\s*/, '').replace(/<[^>]+>/g, '').trim();
    if (tagline && !comedianTaglines[name]) {
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
  return NAME_FIXES[name] || name;
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

// ---- Venue normalization ----
// Map all venue variants to the 3 main rooms
function normalizeVenue(venue) {
  const v = venue.toLowerCase();
  if (v.includes('macdougal') || v.includes('cq room')) return 'MacDougal Street';
  if (v.includes('fat black') || v.includes('fbpc') || v.includes('pussycat') || v.includes('new joke') || v.includes('hot soup')) return 'Fat Black Pussycat';
  if (v.includes('village underground')) return 'Village Underground';
  // Special shows with no room hint — can't determine venue
  return venue;
}

// ---- Show scoring ----
function scoreShow(show) {
  let faves = 0;
  let newFaces = 0;
  for (const name of show.comedians) {
    if (isFav(name)) faves++;
    else if (!isSkip(name)) newFaces++;
  }
  return { faves, newFaces };
}

// ---- Fetch ----
async function fetchDay(dateStr) {
  try {
    const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({
      date: dateStr, venue: 'newyork', type: 'lineup'
    }))}`;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });

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
    const resp = await fetch('/api/the-stand');
    const data = await resp.json();
    standShows = data.shows || [];
    return standShows;
  } catch (e) {
    console.error('Failed to fetch The Stand:', e);
    return [];
  }
}

// ---- Big Shows (SeatGeek) fetch ----
let bigShows = [];

async function fetchBigShows() {
  try {
    const resp = await fetch('/api/big-shows');
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
let activeSource = 'cellar'; // venue source tab

// ---- Render ----
function renderTabs() {
  const nav = document.getElementById('day-tabs');
  nav.innerHTML = '';

  // Hide day tabs for big-shows view
  if (activeSource === 'big-shows') {
    nav.style.display = 'none';
    return;
  }
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
        activeDate = dateStr;
        renderTabs();
        renderShows();
      });
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
    const maxFavs = shows ? Math.max(0, ...shows.map(s => scoreShow(s).faves)) : 0;

    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
      ${maxFavs >= 2 ? `<span class="tab-badge">${maxFavs} faves</span>` : ''}
    `;

    tab.addEventListener('click', () => {
      activeDate = dateStr;
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

  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves').checked;
  const pictureMode = document.getElementById('picture-mode')?.checked;

  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Always render venue filters
  const allShowsFlat = Object.values(allData).flat().filter(Boolean);
  renderVenueFilters(allShowsFlat);

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
  const hasAnyPrefs = prefs.faves.length > 0 || prefs.skips.length > 0;

  // Sort by # faves button
  const sortActive = document.getElementById('sort-by-faves')?.classList.contains('active');

  // If sort is active, show ALL days sorted by fave count
  if (sortActive) {
    renderSortedByFaves(container);
    renderBottomTabs();
    return;
  }

  let sorted = shows;

  let html = '';

  // Show onboarding banner if no prefs set
  if (!hasAnyPrefs) {
    html += `
      <div class="onboard-banner" id="onboard-banner">
        <p><strong>New here?</strong> Tap comedian names to mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
        <button class="onboard-btn" onclick="openModal()">Set Up</button>
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
  // Venue filter (compare against normalized venue name)
  if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return '';

  // Time filter
  const timeFilter = document.getElementById('time-filter')?.value;
  if (timeFilter && timeFilter !== 'any') {
    const showTime24 = to24h(show.time);
    if (showTime24 && showTime24 > timeFilter) return '';
  }

  const stats = scoreShow(show);
  const hasFav = stats.faves > 0;

  if (onlyFavs && !hasFav) return '';

  const comediansHtml = renderComedianChips(show.comedians, hideSkips);

  let badge = '';
  if (stats.faves >= 3) {
    badge = `<span class="show-badge badge-must-go">${stats.faves} FAVS</span>`;
  } else if (stats.faves >= 2) {
    badge = `<span class="show-badge badge-faves">${stats.faves} FAVS</span>`;
  }

  const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';

  // Detect named/special shows vs plain venue variants
  const normalizedVenue = normalizeVenue(show.venue);
  const venueStart = show.venue.toLowerCase();
  const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
  const knownRooms = ['MacDougal Street', 'Fat Black Pussycat', 'Village Underground'];
  const mappedVenue = knownRooms.includes(normalizedVenue) ? normalizedVenue : '';

  return `
    <div class="${cardClass}">
      <div class="show-header">
        <div>
          <span class="show-time">${show.time}</span>
          ${badge}
        </div>
        ${!isPlainVenue ? `<span class="show-name">${show.venue}</span>` : ''}
        <span class="show-venue">${isPlainVenue ? normalizedVenue : mappedVenue}</span>
      </div>
      <div class="show-lineup">${comediansHtml}</div>
      <div class="show-footer">
        ${show.reserveUrl
          ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn">Reserve</a>`
          : '<span></span>'}
        <span class="fav-count">
          ${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}
        </span>
      </div>
    </div>
  `;
}

// ---- Shared comedian chip renderer ----
function renderComedianChips(comedians, hideSkips) {
  const showPhotos = document.getElementById('show-photos')?.checked ?? true;
  const expandBios = document.getElementById('expand-bios')?.checked;
  const expandLongBios = document.getElementById('expand-long-bios')?.checked;
  const showNewcomers = document.getElementById('show-newcomers')?.checked;

  return comedians.map(name => {
    const favd = isFav(name);
    const skipped = isSkip(name);
    let cls = 'comedian';
    let prefix = '';

    if (favd) {
      cls += ' fav';
      prefix = '<span class="star">⭐</span>';
    } else if (skipped) {
      cls += ' skip';
      if (hideSkips) cls += ' hidden-skip';
    } else {
      cls += ' new-face';
    }

    // Newcomer (non-regular) flagging
    const newcomer = showNewcomers && !isRegular(name);
    if (newcomer && !favd && !skipped) cls += ' newcomer';

    const photoUrl = comedianPhotos[name];
    const photoHtml = (showPhotos && photoUrl)
      ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">`
      : '';
    const tagline = comedianTaglines[name] || '';
    const titleAttr = tagline ? ` title="${tagline.replace(/"/g, '&quot;')}"` : '';

    // Newcomer/regular badge
    let badgeHtml = '';
    if (showNewcomers) {
      if (!isRegular(name)) {
        badgeHtml = '<span class="newcomer-badge">NEW</span>';
      }
    }

    // Long bios: show full bio panel inline for every comedian
    if (expandLongBios && !window.V2_MODE && !window.V3_MODE) {
      const bioText = tagline || 'No bio available.';
      return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
        <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${prefix}${name}${badgeHtml}</span>
        <div class="comedian-long-bio">${bioText}</div>
      </div>`;
    }

    // Short bios: show tagline below name
    if (expandBios && !window.V2_MODE && !window.V3_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline-inline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${prefix}<span class="comedian-name-wrap">${name}${badgeHtml}${taglineHtml}</span></span>`;
    }

    // v2 card mode: show tagline text below name
    if (window.V2_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}${prefix}<span class="comedian-name">${name}</span>${taglineHtml}${badgeHtml}</span>`;
    }

    return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${prefix}${name}${badgeHtml}</span>`;
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
      if (onlyFavs && stats.faves === 0) return;
      const timeFilter = document.getElementById('time-filter')?.value;
      if (timeFilter && timeFilter !== 'any') {
        const showTime24 = to24h(show.time);
        if (showTime24 && showTime24 > timeFilter) return;
      }
      allShows.push({ ...show, dateStr, dateObj: d, faves: stats.faves, stats });
    });
  });

  // Sort by fave count descending
  allShows.sort((a, b) => b.faves - a.faves);

  if (allShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows match your filters.</div>';
    renderBottomTabs();
    return;
  }

  let lastDateStr = '';
  let html = '';

  allShows.forEach(show => {
    const stats = show.stats;
    const dateLabel = show.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    // Show date header when date changes
    if (show.dateStr !== lastDateStr) {
      html += `<h2 class="schedule-day-header">${dateLabel}</h2>`;
      lastDateStr = show.dateStr;
    }

    const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';
    let badge = '';
    if (stats.faves >= 3) badge = `<span class="show-badge badge-must-go">${stats.faves} FAVS</span>`;
    else if (stats.faves >= 2) badge = `<span class="show-badge badge-faves">${stats.faves} FAVS</span>`;

    const normalizedVenue = normalizeVenue(show.venue);
    const venueStart = show.venue.toLowerCase();
    const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
    const knownRooms = ['MacDougal Street', 'Fat Black Pussycat', 'Village Underground'];
    const mappedVenue = knownRooms.includes(normalizedVenue) ? normalizedVenue : '';

    const chips = renderComedianChips(show.comedians, hideSkips);

    html += `
      <div class="${cardClass} schedule-card">
        <div class="show-header">
          <div><span class="show-time">${show.time}</span>${badge}</div>
          ${!isPlainVenue ? `<span class="show-name">${show.venue}</span>` : ''}
          <span class="show-venue">${isPlainVenue ? normalizedVenue : mappedVenue}</span>
        </div>
        <div class="show-lineup">${chips}</div>
        <div class="show-footer">
          ${show.reserveUrl ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn">Reserve</a>` : '<span></span>'}
          <span class="fav-count">${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}</span>
        </div>
      </div>`;
  });

  container.innerHTML = html;
  renderBottomTabs();
}

function renderAllDaysSchedule(container) {
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves')?.checked;
  const shouldSort = document.getElementById('sort-by-faves')?.classList.contains('active');
  let html = '<div class="schedule-view">';

  // For The Stand, iterate over stand show dates
  if (activeSource === 'the-stand') {
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      const dayShows = standShows.filter(s => s.date === dateStr);
      if (dayShows.length === 0) {
        html += '<div class="no-shows" style="padding:16px 0;">No shows.</div>';
        return;
      }
      dayShows.forEach(show => {
        html += renderStandShowCard(show);
      });
    });
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;

    if (!shows || shows.length === 0) {
      html += '<div class="no-shows" style="padding:16px 0;">No lineup posted.</div>';
      return;
    }

    const sorted = shouldSort
      ? [...shows].sort((a, b) => scoreShow(b).faves - scoreShow(a).faves)
      : shows;

    sorted.forEach(show => {
      if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return;
      const stats = scoreShow(show);
      if (onlyFavs && stats.faves === 0) return;
      const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';
      let badge = '';
      if (stats.faves >= 3) badge = `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
      else if (stats.faves >= 2) badge = `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;

      const showPhotos = document.getElementById('show-photos')?.checked ?? true;
      const chips = renderComedianChips(show.comedians, document.getElementById('hide-skips').checked);

      html += `
        <div class="${cardClass} schedule-card">
          <div class="show-header">
            <div><span class="show-time">${show.time}</span>${badge}</div>
            <span class="show-venue">${show.venue}</span>
          </div>
          <div class="show-lineup">${chips}</div>
          <div class="show-footer">
            ${show.reserveUrl ? `<a href="${show.reserveUrl}" target="_blank" class="reserve-btn">Reserve</a>` : '<span></span>'}
            <span class="fav-count">${stats.faves > 0 ? `⭐ ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}</span>
          </div>
        </div>`;
    });
  });

  html += '</div>';
  container.innerHTML = html;
}

// ---- The Stand Renderer ----
function renderTheStandShows(container) {
  const pictureMode = document.getElementById('picture-mode')?.checked;
  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Hide cellar-specific venue filters
  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  if (activeDate === 'all') {
    renderAllDaysSchedule(container);
    return;
  }

  const dayShows = standShows.filter(s => s.date === activeDate);
  if (dayShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows for this day.</div>';
    return;
  }

  container.innerHTML = dayShows.map(show => renderStandShowCard(show)).join('');
}

function renderStandShowCard(show) {
  const chips = show.comedians.length > 0
    ? renderComedianChips(show.comedians, document.getElementById('hide-skips')?.checked)
    : `<span style="color:var(--text-dim);font-size:13px;">Lineup TBD</span>`;

  return `
    <div class="stand-show-card">
      <div class="stand-show-header">
        <span class="stand-show-time">${show.time || 'TBD'}</span>
        <span class="stand-show-title">${show.title}</span>
      </div>
      <div class="stand-show-lineup show-lineup">${chips}</div>
      <div class="stand-show-footer">
        ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn">Tickets</a>` : '<span></span>'}
        <span class="show-venue">The Stand NYC</span>
      </div>
    </div>
  `;
}

// ---- Big Shows (SeatGeek) Renderer ----
function renderBigShows(container) {
  container.classList.remove('picture-mode');
  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  // Remove bottom tabs for big shows
  const bt = document.getElementById('bottom-tabs');
  if (bt) bt.innerHTML = '';

  if (bigShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading big shows...</div>';
    return;
  }

  // Group by date
  const byDate = {};
  bigShows.forEach(evt => {
    const date = evt.date || 'Unknown';
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(evt);
  });

  let html = '<div class="big-shows-section">';
  html += '<h2 class="big-shows-header">Upcoming NYC Comedy Shows</h2>';

  Object.keys(byDate).sort().forEach(dateStr => {
    const d = new Date(dateStr + 'T12:00:00');
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;

    byDate[dateStr].forEach(evt => {
      html += `
        <div class="big-show-card">
          <div class="big-show-info">
            <div class="big-show-title">${evt.title}</div>
            <div class="big-show-meta">
              <span class="big-show-venue">${evt.venue}</span>
              <span>${evt.time || ''}</span>
              ${evt.price ? `<span class="big-show-price">From $${evt.price}</span>` : ''}
            </div>
            ${evt.performers ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">${evt.performers}</div>` : ''}
            ${evt.url ? `<a href="${evt.url}" target="_blank" class="big-show-link">Get Tickets</a>` : ''}
          </div>
        </div>
      `;
    });
  });

  html += '</div>';
  container.innerHTML = html;
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
  if (activeSource === 'big-shows') return;

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
  const name = el.dataset.name;
  const quickMode = document.getElementById('quick-mode')?.checked;

  // Quick fav/skip mode: cycle like before
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

  const tagline = comedianTaglines[name] || 'No bio available.';
  const photo = comedianPhotos[name] || '';
  const prefs = loadPrefs();
  const isFavd = prefs.faves.includes(name);
  const isSkipd = prefs.skips.includes(name);
  const isNeutral = !isFavd && !isSkipd;
  const esc = name.replace(/'/g, "\\'");
  const regular = isRegular(name);
  const alerted = isAlerted(name);

  // Try to find fuller bio from DB
  const dbEntry = comedianDB.find(c => c.name === name);
  const fullBio = dbEntry?.bio || tagline;
  const dbPhoto = dbEntry?.photo_stand || dbEntry?.photo_nycc || photo;
  const venues = dbEntry?.venues?.join(', ') || '';

  const panel = document.createElement('div');
  panel.className = 'comedian-expanded open';
  panel.dataset.for = name;
  panel.innerHTML = `
    ${dbPhoto ? `<img src="${dbPhoto}" alt="${name}">` : ''}
    <div class="exp-info">
      <div class="exp-name">${name}${regular ? ' <span class="regular-badge">REGULAR</span>' : ' <span class="newcomer-badge">NEW</span>'}</div>
      <div class="exp-tagline">${fullBio}</div>
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
  el.after(panel);
}

function toggleAlertBtn(name, btn) {
  toggleAlert(name);
  const alerted = isAlerted(name);
  btn.className = 'exp-btn' + (alerted ? ' is-alert' : '');
  btn.textContent = alerted ? '🔔 Alerted' : '🔕 Alert me';
}

function setPref(name, type) {
  const prefs = loadPrefs();
  prefs.faves = prefs.faves.filter(n => n !== name);
  prefs.skips = prefs.skips.filter(n => n !== name);
  if (type === 'fav') prefs.faves.push(name);
  else if (type === 'skip') prefs.skips.push(name);
  // 'neutral' = just remove from both (already done above)
  savePrefs(prefs);
  renderTabs();
  renderShows();
}

// ---- Modal ----
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderModal();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
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

  // All comedians
  const allList = document.getElementById('all-list');
  const sorted = [...allComediansSeen].sort();
  allList.innerHTML = sorted
    .filter(n => n.toLowerCase().includes(filterLower))
    .map(n => {
      let cls = 'chip';
      if (prefs.faves.includes(n)) cls += ' fav-state';
      else if (prefs.skips.includes(n)) cls += ' skip-state';
      return `<span class="${cls}" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`;
    }).join('');
}

function modalCycle(name) {
  cycleComedian(name);
  const search = document.getElementById('comedian-search').value;
  renderModal(search);
}

// ---- Reset filters visibility ----
function updateResetBtn() {
  const btn = document.getElementById('reset-filters');
  if (!btn) return;
  const anyActive =
    document.getElementById('hide-skips')?.checked ||
    document.getElementById('only-faves')?.checked ||
    document.getElementById('sort-by-faves')?.classList.contains('active') ||
    document.getElementById('expand-bios')?.checked ||
    document.getElementById('expand-long-bios')?.checked ||
    document.getElementById('quick-mode')?.checked ||
    document.getElementById('picture-mode')?.checked ||
    document.getElementById('show-newcomers')?.checked ||
    !document.getElementById('show-photos')?.checked ||
    (document.getElementById('time-filter')?.value !== 'any') ||
    activeVenue !== 'all';
  btn.style.display = anyActive ? 'inline-block' : 'none';
}

// ---- Theme toggle ----
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
const comedianTaglines = {};

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

  // Fetch all sources in parallel
  const [cellarResults] = await Promise.all([
    Promise.all(dates.map(d => fetchDay(formatDateParam(d)))),
    fetchTheStand(),
    fetchBigShows(),
    loadComedianDB()
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

  document.getElementById('loading').style.display = 'none';
  initTheme();
  renderSourceTabs();
  renderTabs();
  renderShows();

  // Venue source tab listeners
  document.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSource = btn.dataset.source;
      activeDate = 'all';
      activeVenue = 'all';
      renderSourceTabs();
      renderTabs();
      renderShows();
    });
  });

  // Filter listeners
  document.getElementById('hide-skips').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('only-faves').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('show-photos')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('time-filter')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('sort-by-faves')?.addEventListener('click', () => {
    document.getElementById('sort-by-faves').classList.toggle('active');
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
  document.getElementById('show-newcomers')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });

  // Reset filters
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    document.getElementById('hide-skips').checked = false;
    document.getElementById('only-faves').checked = false;
    const sbf = document.getElementById('sort-by-faves'); if (sbf) sbf.classList.remove('active');
    document.getElementById('expand-bios').checked = false;
    const elb = document.getElementById('expand-long-bios'); if (elb) elb.checked = false;
    document.getElementById('quick-mode').checked = false;
    const pm = document.getElementById('picture-mode'); if (pm) pm.checked = false;
    const sn = document.getElementById('show-newcomers'); if (sn) sn.checked = false;
    const sp = document.getElementById('show-photos'); if (sp) sp.checked = true;
    const tf = document.getElementById('time-filter');
    if (tf) tf.value = 'any';
    activeVenue = 'all';
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ faves: [], skips: [] }));
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('comedian-search').value = '';
      renderModal();
      renderTabs();
    }
  });

  document.getElementById('share-link').addEventListener('click', () => {
    const prefs = loadPrefs();
    const params = new URLSearchParams();
    if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
    if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
    const url = window.location.origin + window.location.pathname + '#' + params.toString();
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('share-link');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Share Link'; }, 2000);
    });
  });
}

init();

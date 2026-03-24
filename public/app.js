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
  if (v.includes('fat black') || v.includes('fbpc') || v.includes('pussycat') || v.includes('new joke')) return 'Fat Black Pussycat';
  if (v.includes('village underground')) return 'Village Underground';
  // Residencies and special shows — check if venue name contains a known room
  if (v.includes('hot soup')) return 'Fat Black Pussycat';
  return venue; // fallback to original
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

// ---- State ----
let allData = {};
let activeDate = null;
let dates = [];
let allComediansSeen = new Set();
let activeVenue = 'all'; // venue filter

// ---- Render ----
function renderTabs() {
  const nav = document.getElementById('day-tabs');
  nav.innerHTML = '';

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

function renderShows() {
  const container = document.getElementById('shows-container');
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves').checked;

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

  // Render venue filter buttons (use first available day's shows for "all" mode)
  const venueShows = activeDate === 'all'
    ? Object.values(allData).flat().filter(Boolean)
    : allData[activeDate];
  renderVenueFilters(venueShows);

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

  html += sorted.map(show => {
    // Venue filter (compare against normalized venue name)
    if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return '';

    // Time filter
    const timeFilter = document.getElementById('time-filter')?.value;
    if (timeFilter && timeFilter !== 'any') {
      const showTime24 = to24h(show.time);
      if (showTime24 && showTime24 > timeFilter) return '';
    }

    const stats = scoreShow(show);
    const isMustGo = stats.faves >= 3;
    const hasFav = stats.faves > 0;

    if (onlyFavs && !hasFav) return '';

    const showPhotos = document.getElementById('show-photos')?.checked ?? true;
    const comediansHtml = show.comedians.map(name => {
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

      const photoUrl = comedianPhotos[name];
      const photoHtml = (showPhotos && photoUrl)
        ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">`
        : '';
      const tagline = comedianTaglines[name] || '';
      const titleAttr = tagline ? ` title="${tagline.replace(/"/g, '&quot;')}"` : '';
      const expandBios = document.getElementById('expand-bios')?.checked;
      const expandLongBios = document.getElementById('expand-long-bios')?.checked;

      // Long bios: show full bio panel inline for every comedian
      if (expandLongBios && !window.V2_MODE && !window.V3_MODE) {
        const bioText = tagline || 'No bio available.';
        return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
          <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${prefix}${name}</span>
          <div class="comedian-long-bio">${bioText}</div>
        </div>`;
      }

      // Short bios: show tagline below name
      if (expandBios && !window.V2_MODE && !window.V3_MODE) {
        const taglineHtml = tagline ? `<span class="comedian-tagline-inline">${tagline}</span>` : '';
        return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${prefix}<span class="comedian-name-wrap">${name}${taglineHtml}</span></span>`;
      }

      // v2 card mode: show tagline text below name
      if (window.V2_MODE) {
        const taglineHtml = tagline ? `<span class="comedian-tagline">${tagline}</span>` : '';
        return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}${prefix}<span class="comedian-name">${name}</span>${taglineHtml}</span>`;
      }

      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${prefix}${name}</span>`;
    }).join('');

    let badge = '';
    if (stats.faves >= 3) {
      badge = `<span class="show-badge badge-must-go">${stats.faves} FAVS</span>`;
      // Previously: badge = '<span class="show-badge badge-must-go">MUST-GO</span>';
    } else if (stats.faves >= 2) {
      badge = `<span class="show-badge badge-faves">${stats.faves} FAVS</span>`;
    }

    const cardClass = stats.faves >= 3 ? 'show-card must-go' : 'show-card';

    // Detect named/special shows vs plain venue variants
    const normalizedVenue = normalizeVenue(show.venue);
    const venueStart = show.venue.toLowerCase();
    const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
    // Named show: show name centered + venue on right (if we can map it)
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
  }).join('');

  container.innerHTML = html;

  // Render bottom nav tabs
  renderBottomTabs();
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

  const showPhotos = true;
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

    const chips = show.comedians.map(name => {
      const favd = isFav(name);
      const skipped = isSkip(name);
      let cls = 'comedian';
      let prefix = '';
      if (favd) { cls += ' fav'; prefix = '<span class="star">⭐</span>'; }
      else if (skipped) { cls += ' skip'; if (hideSkips) cls += ' hidden-skip'; }
      else { cls += ' new-face'; }
      const photoUrl = comedianPhotos[name];
      const photoHtml = photoUrl ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}${prefix}${name}</span>`;
    }).join('');

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
      const chips = show.comedians.map(name => {
        const favd = isFav(name);
        const skipped = isSkip(name);
        let cls = 'comedian';
        let prefix = '';
        if (favd) { cls += ' fav'; prefix = '<span class="star">⭐</span>'; }
        else if (skipped) { cls += ' skip'; if (hideSkips) cls += ' hidden-skip'; }
        else { cls += ' new-face'; }
        const photoUrl = comedianPhotos[name];
        const photoHtml = (showPhotos && photoUrl) ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">` : '';
        return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}${prefix}${name}</span>`;
      }).join('');

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

function renderVenueFilters(shows) {
  const container = document.getElementById('venue-filters');
  if (!container) return;
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

  const panel = document.createElement('div');
  panel.className = 'comedian-expanded open';
  panel.dataset.for = name;
  panel.innerHTML = `
    ${photo ? `<img src="${photo}" alt="${name}">` : ''}
    <div class="exp-info">
      <div class="exp-name">${name}</div>
      <div class="exp-tagline">${tagline}</div>
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
      </div>
    </div>
  `;
  el.after(panel);
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

  const results = await Promise.all(
    dates.map(d => fetchDay(formatDateParam(d)))
  );

  dates.forEach((d, i) => {
    const dateStr = formatDateParam(d);
    allData[dateStr] = results[i];
    if (results[i]) {
      results[i].forEach(show => {
        show.comedians.forEach(name => allComediansSeen.add(name));
      });
    }
  });

  document.getElementById('loading').style.display = 'none';
  initTheme();
  renderTabs();
  renderShows();

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

  // Reset filters
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    document.getElementById('hide-skips').checked = false;
    document.getElementById('only-faves').checked = false;
    const sbf = document.getElementById('sort-by-faves'); if (sbf) sbf.classList.remove('active');
    document.getElementById('expand-bios').checked = false;
    const elb = document.getElementById('expand-long-bios'); if (elb) elb.checked = false;
    document.getElementById('quick-mode').checked = false;
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

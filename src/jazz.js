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

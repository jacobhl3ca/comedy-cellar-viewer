
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
  allTab.addEventListener('click', () => {
    activeDate = 'all';
    renderTabs();
    renderShows();
  });
  nav.appendChild(allTab);

  if (activeSource === 'the-stand') {

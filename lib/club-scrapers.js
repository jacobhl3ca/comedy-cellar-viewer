// Shared club scrapers for the live /api/clubs endpoint.
//
// These live in lib/ (not api/) on purpose: Vercel counts every file under api/
// as a serverless function, and the Hobby plan caps deployments at 12. Folding
// the per-club scrapers behind a single /api/clubs?venue=X dispatcher keeps the
// function count flat no matter how many venues we add. Each scraper returns a
// plain array of show objects; api/clubs.js wraps it as { shows, count, source }.
//
// NOTE: scripts/prebake.js has its own richer copies (with bios/photos) that bake
// the static caches the app loads first — these are only the live fallback.

const https = require('https');
const fs = require('fs');
const path = require('path');

// Names/photos that live only on Stand Up NY posters, extracted offline by macOS
// Vision OCR (scripts/enrich-standupny.mjs) and committed to data/. Keyed by
// VenuePilot event id; merged over the title/description names below.
function loadStandupnyEnrichment() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'standupny-enrichment.json'), 'utf8')); }
  catch { return {}; }
}
function applyStandupnyEnrichment(shows) {
  const enr = loadStandupnyEnrichment();
  const eid = url => (String(url).match(/events\/(\d+)/) || [])[1] || '';
  for (const s of shows) {
    const e = enr[eid(s.url)];
    if (!e) continue;
    if (Array.isArray(e.comedians) && e.comedians.length) s.comedians = e.comedians;
    if (e.photos && Object.keys(e.photos).length) s.comedianPhotos = e.photos;
  }
  return shows;
}

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------
function fetchText(url, { timeout = 12000, headers = {}, label = 'fetch' } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...headers,
      },
    }, (resp) => {
      if (resp.statusCode >= 400) { resp.resume(); return reject(new Error(`${label} HTTP ${resp.statusCode}`)); }
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    request.setTimeout(timeout, () => { request.destroy(); reject(new Error(`${label} timeout`)); });
    request.on('error', reject);
  });
}

function postJSON(url, body, { timeout = 12000, headers = {}, label = 'post' } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from ${label}`)); }
      });
    });
    request.setTimeout(timeout, () => { request.destroy(); reject(new Error(`${label} timeout`)); });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// "8:30 PM" -> minutes since midnight, for stable intra-day sorting.
function timeToMinutes(t) {
  const m = (t || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

// ---------------------------------------------------------------------------
// Gotham Comedy Club — parse the server-rendered .gsc-schedule-row schedule.
// (SquadUp's JSON API now sits behind a Cloudflare challenge / 403.)
// ---------------------------------------------------------------------------
const GOTHAM_MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function gothamDecode(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
async function scrapeGotham() {
  const html = await fetchText('https://gothamcomedyclub.com/', { label: 'Gotham' });
  const today = todayNY();
  const events = [];
  for (const block of html.split('<div class="gsc-schedule-row">').slice(1)) {
    const dayM = block.match(/gsc-schedule-date day">(\d+)</);
    const monM = block.match(/month-year">\s*<div class="gsc-schedule-date">(\w+)<\/div>\s*<div class="gsc-schedule-date">(\d+)<\/div>/);
    const titleM = block.match(/gsc-schedule-title"><a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!dayM || !monM || !titleM) continue;
    const month = GOTHAM_MONTHS[monM[1]];
    if (!month) continue;
    const date = `${monM[2]}-${String(month).padStart(2, '0')}-${String(dayM[1]).padStart(2, '0')}`;
    if (date < today) continue;
    const timeM = block.match(/gsc-schedule-time">([^<]+)</);
    const imgM = block.match(/gsc-schedule-thumb">\s*<img[^>]+src="([^"]+)"/);
    let image = imgM ? imgM[1] : '';
    if (image.startsWith('//')) image = 'https:' + image;
    events.push({
      title: gothamDecode(titleM[2]), date, time: timeM ? timeM[1].trim() : '',
      venue: 'Gotham Comedy Club', price: null, url: titleM[1], description: '', image,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.time) - timeToMinutes(b.time));
  return events;
}

// ---------------------------------------------------------------------------
// Stand Up NY — VenuePilot public GraphQL API (account 2535).
// ---------------------------------------------------------------------------
function standupnyFmtTime(t) {
  const m = (t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1], 10); const min = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return `${h}:${min} ${ap}`;
}
// Announced headliner name(s) for a Stand Up NY event. VenuePilot's structured
// artist fields (announceArtists/artists) are always empty for this account, but
// the billed name reliably shows up in the title ("Stand Up NY Presents: Patton
// Oswalt") and/or the opening line of the description ("Patton Oswalt is an
// acclaimed stand-up comedian…"). Generic house/showcase shows have no billed
// name — return [] rather than guess. (Kept in sync with scripts/prebake.js.)
const NAME_TOKEN = "[A-Z][A-Za-z.'’-]+";
const PERSON_RE = new RegExp(`^${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3}$`);
const GENERIC_NAME_RE = /\b(house show|open mic|showcase|show|mic|night|day|benefit|new faces|late|early|comedy|presents|tba|anniversary|festival|party|special)\b/i;
function nameLooksReal(s) { return !!s && PERSON_RE.test(s) && !GENERIC_NAME_RE.test(s); }
function standupnyHeadliners(title, description) {
  const out = [];
  const stripped = (title || '')
    .replace(/^.*?\bpresents\s*:\s*/i, '')
    .replace(/^stand\s*up\s*ny\s*:\s*/i, '')
    .trim();
  if (stripped && stripped !== title && nameLooksReal(stripped)) out.push(stripped);
  const dm = (description || '').match(new RegExp(
    `^(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3})\\s+is\\s+(?:an?\\s+)?[\\w\\s,'’-]{0,60}?\\b(?:stand-?up|comedian|comic)\\b`, 'i'));
  if (dm && nameLooksReal(dm[1])) out.push(dm[1].trim());
  return [...new Map(out.map(n => [n.toLowerCase(), n])).values()];
}
async function scrapeStandupNY() {
  const today = todayNY();
  const query = `{ paginatedEvents(arguments:{accountIds:[2535], startDate:"${today}", limit:200}){ collection { id name date startTime status images description } } }`;
  const data = await postJSON('https://www.venuepilot.co/graphql', JSON.stringify({ query }), {
    headers: { 'Origin': 'https://standupny.com', 'Referer': 'https://standupny.com/' },
    label: 'VenuePilot',
  });
  const collection = data?.data?.paginatedEvents?.collection || [];
  const mapped = collection
    .filter(e => e.date && e.date >= today)
    .map(e => {
      const title = gothamDecode(e.name);
      const description = gothamDecode(e.description).slice(0, 500);
      return {
        title, date: e.date, time: standupnyFmtTime(e.startTime),
        venue: 'Stand Up NY', price: null,
        url: `https://standupny.com/#/events/${e.id}`, description,
        image: Array.isArray(e.images) ? (e.images[0] || '') : '',
        comedians: standupnyHeadliners(title, description),
        soldOut: /sold\s*out/i.test(e.status || ''),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.time) - timeToMinutes(b.time));
  return applyStandupnyEnrichment(mapped);
}

// ---------------------------------------------------------------------------
// Union Hall (Park Slope, Brooklyn) — ticketed comedy runs through Eventbrite.
// Their public organizer API (org 17899496497) returns clean JSON with a
// built-in Comedy taxonomy tag (category 105 / subcategory 5010), so we get the
// program without HTML parsing or keyword-guessing. (Kept in sync with prebake.)
// ---------------------------------------------------------------------------
const UNIONHALL_ORG = '17899496497';
function eventbriteFmtTime(local) {
  // local is wall-clock "YYYY-MM-DDTHH:MM:SS" already in America/New_York.
  const m = (local || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1], 10); const min = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return `${h}:${min} ${ap}`;
}
async function scrapeUnionHall() {
  const today = todayNY();
  const pages = [1, 2];
  const results = await Promise.all(pages.map(p =>
    fetchText(`https://www.eventbrite.com/api/v3/organizers/${UNIONHALL_ORG}/events/?page=${p}&expand=ticket_availability`, { label: 'Union Hall' })
      .then(t => { try { return JSON.parse(t); } catch { return null; } })
      .catch(() => null)
  ));
  const events = results.filter(Boolean).flatMap(r => r.events || []);
  const seen = new Set();
  return events
    // Eventbrite's own taxonomy: 105 = Performing & Visual Arts, 5010 = Comedy.
    .filter(e => String(e.category_id) === '105' && String(e.subcategory_id) === '5010')
    .map(e => {
      const local = e.start && e.start.local || '';
      const ta = e.ticket_availability || {};
      const min = ta.minimum_ticket_price || {};
      const price = ta.is_free ? '0' : (min.major_value != null ? String(Math.round(parseFloat(min.major_value))) : null);
      return {
        title: gothamDecode((e.name && e.name.text) || ''),
        date: local.slice(0, 10),
        time: eventbriteFmtTime(local),
        venue: 'Union Hall', price,
        url: e.url || '', description: '',
        image: (e.logo && e.logo.url) || '',
        soldOut: false,
      };
    })
    .filter(e => e.title && e.date && e.date >= today)
    .filter(e => { const k = e.url || `${e.title}|${e.date}|${e.time}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.time) - timeToMinutes(b.time));
}

// ---------------------------------------------------------------------------
// The Stand NYC — paginated /shows HTML.
// ---------------------------------------------------------------------------
async function scrapeTheStand() {
  const offsets = [0, 20, 40, 60, 80, 100, 120, 140, 160];
  const urls = offsets.map(o => o === 0 ? 'https://thestandnyc.com/shows' : `https://thestandnyc.com/shows/P${o}`);
  const pages = await Promise.all(urls.map(u => fetchText(u, { label: 'The Stand' }).catch(() => '')));
  const html = pages.join('\n');
  const blocks = html.split('<div class="row show_row ">');
  const seen = new Set();
  const shows = [];
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const urlMatch = block.match(/showtitle d-none d-sm-block"><a href="https:\/\/thestandnyc\.com\/?\/?([^"]*)">(.*?)<\/a>/);
    if (!urlMatch) continue;
    const path = urlMatch[1];
    const title = urlMatch[2].trim();
    if (seen.has(path)) continue;
    seen.add(path);
    const url = 'https://thestandnyc.com/' + path;
    const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
    let date = '', time = '';
    if (dateMatch) {
      date = dateMatch[1];
      let hour = parseInt(dateMatch[2]);
      const minute = dateMatch[3];
      const ampm = hour < 12 ? 'AM' : 'PM';
      if (hour > 12) hour -= 12;
      if (hour === 0) hour = 12;
      time = `${hour}:${minute} ${ampm}`;
    }
    const roomMatch = block.match(/list-show-room">(.*?)<\/span>/);
    const room = roomMatch ? roomMatch[1].trim() : '';
    const nameMatches = [...block.matchAll(/<small>(.*?)<\/small>/g)];
    const comedians = [...new Set(nameMatches
      .map(m => m[1].trim())
      .filter(n => n && n.length > 1 && !n.match(/^\$/) && !/^special\s*guests?$/i.test(n) && !/^more\s*tba$/i.test(n))
    )];
    const comedianPhotos = {};
    const photoMatches = [...block.matchAll(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"[^>]*>/gi)];
    photoMatches.forEach(m => {
      const imgUrl = m[1];
      const filenameMatch = imgUrl.match(/\/([^/]+)\.(jpg|jpeg|png|webp)$/i);
      if (filenameMatch) {
        const photoName = filenameMatch[1].replace(/_/g, ' ').replace(/-/g, ' ').replace(/\s*\d+$/, '');
        for (const c of comedians) {
          const cNorm = c.toLowerCase().replace(/[.\-']/g, ' ');
          const pNorm = photoName.toLowerCase();
          if (cNorm === pNorm || pNorm.includes(c.split(' ').pop().toLowerCase()) || c.split(' ')[0].toLowerCase() === pNorm) {
            comedianPhotos[c] = imgUrl;
            break;
          }
        }
      }
    });
    const priceMatch = block.match(/\$(\d+\.?\d*)/);
    const price = priceMatch ? priceMatch[1] : '';
    const posterMatch = block.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/shows\/[^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : '';
    const soldout = /btn-outline-danger[^>]*>Sold Out/i.test(block);
    shows.push({ title, date, time, comedians, url, venue: 'The Stand NYC', room, price, poster, comedianPhotos, soldout });
  }
  return shows;
}

// ---------------------------------------------------------------------------
// NY Comedy Club — month calendar; events live in each day cell's data-content.
// ---------------------------------------------------------------------------
function nyccDecode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function nyccTo24h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeStr.trim());
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}
function nyccParseCalendar(html) {
  if (!html) return [];
  const shows = [];
  const dayPattern = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[\s\S]*?data-content="([^"]+)"/g;
  let m;
  while ((m = dayPattern.exec(html)) !== null) {
    const date = m[1];
    const content = nyccDecode(m[2]);
    const evPattern = /<a[^>]+href="(\/events\/[^"]+)"[^>]*>([^<]+?)\s-\s(\d{1,2}:\d{2}\s*[AP]M)<\/a>/gi;
    let em;
    while ((em = evPattern.exec(content)) !== null) {
      const path = em[1];
      const titleRaw = em[2].trim();
      const time = nyccTo24h(em[3].trim());
      const isLineup = !/^[^,]+ ft:?\s|:\s/i.test(titleRaw);
      const comedians = isLineup ? titleRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      shows.push({ title: titleRaw, date, time, comedians, url: 'https://newyorkcomedyclub.com' + path, venue: 'NY Comedy Club', room: '' });
    }
  }
  return shows;
}
async function scrapeNYCC() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const months = [
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`,
  ];
  const pages = await Promise.all(months.map(m => fetchText(`https://newyorkcomedyclub.com/calendar/${m}`, { timeout: 15000, label: 'NYCC' }).catch(() => '')));
  const shows = pages.flatMap(nyccParseCalendar);
  const today = todayNY();
  const seen = new Set();
  return shows
    .filter(s => s.date >= today)
    .filter(s => {
      const k = `${s.url}|${s.date}|${s.time}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

module.exports = { scrapeGotham, scrapeStandupNY, scrapeTheStand, scrapeNYCC, scrapeUnionHall, applyStandupnyEnrichment };

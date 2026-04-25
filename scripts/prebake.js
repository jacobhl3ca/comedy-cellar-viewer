#!/usr/bin/env node
/**
 * Nightly prebake script — runs via GitHub Actions at 3am ET
 *
 * 1. Pulls Comedy Cellar lineups for next 7 days → saves raw HTML as static JSON
 * 2. Pulls The Stand, Gotham, NYCC, Big Shows → saves as static JSON
 * 3. Extracts all comedian names + external photo URLs
 * 4. Downloads missing photos as local files
 * 5. Fetches missing bios from Wikipedia
 * 6. Updates comedians.json + photo-manifest.json
 * 7. GitHub Actions handles git commit + push → triggers Vercel deploy
 *
 * Result: entire site loads from static JSON files on Vercel CDN.
 * Zero serverless function invocations at runtime.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');


const ROOT = path.resolve(__dirname, '..');
const PHOTOS_DIR = path.join(ROOT, 'public', 'photos');
const MANIFEST_PATH = path.join(ROOT, 'public', 'data', 'photo-manifest.json');
const COMEDIANS_PATH = path.join(ROOT, 'public', 'data', 'comedians.json');
const LOG_PATH = path.join(ROOT, 'scripts', 'prebake.log');

// ---- Logging ----
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

// ---- HTTP helpers ----
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      ...options,
    }, (resp) => {
      // Follow redirects
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return fetch(resp.headers.location, options).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

function fetchJSON(url) {
  return fetch(url).then(buf => JSON.parse(buf.toString()));
}

function fetchPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 12000
    }, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.write(data);
    req.end();
  });
}

function fetchText(url) {
  return fetch(url).then(buf => buf.toString());
}

function postJSON(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.comedycellar.com/new-york-line-up/',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Comedy Cellar')); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Cellar API timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- Name helpers ----
const NAME_FIXES = {
  'Will Sylvince': 'Wil Sylvince',
  'Luis Gomez': 'Luis J Gomez',
  'Peter Fowler': 'Peter James Fowler',
  'Crystal Marie': 'Crystal Marie Denha',
};

function normalizeName(name) {
  const clean = decodeHtmlEntities(name.replace(/<[^>]+>/g, '')).trim();
  return NAME_FIXES[clean] || clean;
}

function nameToSlug(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&#8217;/g, '\u2019').replace(/&#8216;/g, '\u2018')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '');  // strip any remaining numeric entities
}

function nameToFilename(name) {
  return decodeHtmlEntities(name).toLowerCase()
    .replace(/['''\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---- Step 1: Scrape Comedy Cellar (next 7 days) ----
// Returns { comedians: Map, batchResults: object } — batchResults saved as static JSON
async function scrapeCellar() {
  log('Scraping Comedy Cellar lineups...');
  const comedians = new Map(); // name -> { photoUrl, tagline }
  const batchResults = {}; // dateStr -> raw API response (saved as static JSON)

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  for (const dateStr of dates) {
    try {
      const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({
        date: dateStr, venue: 'newyork', type: 'lineup'
      }))}`;
      const data = await postJSON('www.comedycellar.com', '/lineup/api/', body);
      batchResults[dateStr] = data; // Save raw response
      const html = data?.show?.html || '';

      // Extract photos
      const photoMatches = [...html.matchAll(/<img src="([^"]+)"[^>]*>[\s\S]*?<span class="name">([^<]+)<\/span>/g)];
      for (const m of photoMatches) {
        const name = normalizeName(m[2]);
        const imgUrl = m[1].startsWith('http') ? m[1] : 'https://www.comedycellar.com' + m[1];
        if (!comedians.has(name)) comedians.set(name, {});
        const c = comedians.get(name);
        if (!c.photoUrl) c.photoUrl = imgUrl;
        c.source = 'cellar';
      }

      // Extract taglines
      const tagMatches = [...html.matchAll(/<span class="name">([^<]+)<\/span>\s*(.*?)<\/p>/g)];
      for (const m of tagMatches) {
        const name = normalizeName(m[1]);
        let tagline = m[2].trim().replace(/^,\s*/, '').replace(/<[^>]+>/g, '').trim();
        if (tagline && !isGenericBio(tagline)) {
          if (!comedians.has(name)) comedians.set(name, {});
          const c = comedians.get(name);
          if (!c.tagline) c.tagline = tagline;
        }
      }

      log(`  ${dateStr}: parsed OK`);
    } catch (e) {
      log(`  ${dateStr}: ERROR - ${e.message}`);
      batchResults[dateStr] = { error: e.message };
    }
  }

  log(`Comedy Cellar: found ${comedians.size} comedians`);
  return { comedians, batchResults, dates };
}

// ---- Step 2: Scrape The Stand ----
// Returns { comedians: Map, shows: array } — shows saved as static JSON
async function scrapeStand() {
  log('Scraping The Stand...');
  const comedians = new Map(); // name -> { photoUrl }
  const allShows = [];
  const seen = new Set();

  const offsets = [0, 20, 40, 60, 80, 100, 120, 140, 160];
  for (const offset of offsets) {
    try {
      const url = offset === 0
        ? 'https://thestandnyc.com/shows'
        : `https://thestandnyc.com/shows/P${offset}`;
      const html = await fetchText(url);

      const blocks = html.split('<div class="row show_row ">');
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        // Extract URL and title (same logic as api/the-stand.js)
        const urlMatch = block.match(/showtitle d-none d-sm-block"><a href="https:\/\/thestandnyc\.com\/?\/?([^"]*)">(.*?)<\/a>/);
        if (!urlMatch) continue;
        const showPath = urlMatch[1];
        const title = urlMatch[2].trim();
        if (seen.has(showPath)) continue;
        seen.add(showPath);

        const showUrl = 'https://thestandnyc.com/' + showPath;
        const dateMatch = showPath.match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
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

        // Extract comedian names
        const nameMatches = [...block.matchAll(/<small>(.*?)<\/small>/g)];
        const names = [...new Set(nameMatches
          .map(m => normalizeName(decodeHtmlEntities(m[1].trim())))
          .filter(n => n && n.length > 1 && !n.match(/^\$/) && !/^special\s*guests?$/i.test(n) && !/^more\s*tba$/i.test(n))
        )];

        // Extract comedian photos
        const comedianPhotos = {};
        const photoMatches = [...block.matchAll(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"[^>]*>/gi)];
        for (const pm of photoMatches) {
          const imgUrl = pm[1];
          const filenameMatch = imgUrl.match(/\/([^/]+)\.(jpg|jpeg|png|webp)$/i);
          if (filenameMatch) {
            const photoName = filenameMatch[1].replace(/_/g, ' ').replace(/-/g, ' ').replace(/\s*\d+$/, '');
            for (const c of names) {
              const cNorm = c.toLowerCase().replace(/[.\-']/g, ' ');
              const pNorm = photoName.toLowerCase();
              if (cNorm === pNorm || pNorm.includes(c.split(' ').pop().toLowerCase()) || c.split(' ')[0].toLowerCase() === pNorm) {
                comedianPhotos[c] = imgUrl;
                if (!comedians.has(c)) comedians.set(c, {});
                comedians.get(c).photoUrl = imgUrl;
                comedians.get(c).source = 'stand';
                break;
              }
            }
          }
        }

        // Extract price + poster
        const priceMatch = block.match(/\$(\d+\.?\d*)/);
        const price = priceMatch ? priceMatch[1] : '';
        const posterMatch = block.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/shows\/[^"]+)"/i);
        const poster = posterMatch ? posterMatch[1] : '';

        // Detect sold-out: Stand replaces "Buy Tickets" link with <span class="btn btn-outline-danger">Sold Out</span>
        const soldout = /btn-outline-danger[^>]*>Sold Out/i.test(block);

        allShows.push({ title, date, time, comedians: names, url: showUrl, venue: 'The Stand NYC', room, price, poster, comedianPhotos, soldout });

        // Register names even without photos
        for (const n of names) {
          if (!comedians.has(n)) comedians.set(n, {});
        }
      }
    } catch (e) {
      log(`  Stand offset ${offset}: ERROR - ${e.message}`);
    }
  }

  log(`The Stand: found ${comedians.size} comedians, ${allShows.length} shows`);
  return { comedians, shows: allShows };
}

// ---- Step 3: Try photo sources for a comedian ----
async function findPhoto(name) {
  const slug = nameToSlug(name);

  // Source 1: The Stand profile page
  try {
    const html = await fetchText(`https://thestandnyc.com/comedians/${slug}`);
    const match = html.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"/i);
    if (match) return { url: match[1], source: 'stand-profile' };
  } catch {}

  // Source 2: NYCC profile page
  try {
    const html = await fetchText(`https://newyorkcomedyclub.com/comedians/${slug}`);
    if (!html.includes('/comedians"') || html.includes(`/comedians/${slug}"`)) {
      const match = html.match(/<img[^>]+src="(\/img\/(?:comedians|imagetest)\/[^"]+)"/i);
      if (match) {
        const photoPath = match[1].split('?')[0];
        return { url: `https://www.newyorkcomedyclub.com${photoPath}`, source: 'nycc-profile' };
      }
    }
  } catch {}

  // Source 3: SeatGeek performer search (has real photos for many acts)
  try {
    const data = await fetchJSON(`https://api.seatgeek.com/2/performers?q=${encodeURIComponent(name)}&client_id=${SEATGEEK_CLIENT_ID}`);
    const perf = (data.performers || []).find(p =>
      p.name.toLowerCase() === name.toLowerCase() && p.image && !p.image.includes('/generic-comedy')
      && !(p.image_attribution || '').toLowerCase().startsWith('seatgeek')
    );
    if (perf?.image) return { url: perf.image, source: 'seatgeek-performer' };
  } catch {}

  // Source 4: Ticketmaster attraction search (good photos for touring acts)
  try {
    const data = await fetchJSON(`https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=${TM_API_KEY}&keyword=${encodeURIComponent(name)}&size=5`);
    const attraction = (data._embedded?.attractions || []).find(a =>
      a.name.toLowerCase() === name.toLowerCase() && a.images?.length
    );
    if (attraction) {
      const imgs = (attraction.images || []).filter(i => i.url && !/ticketm\.net\/dam\/c\//.test(i.url));
      const best = imgs.filter(i => i.ratio === '16_9').sort((x, y) => (y.width || 0) - (x.width || 0))[0]
        || imgs.sort((x, y) => (y.width || 0) - (x.width || 0))[0];
      if (best?.url) return { url: best.url, source: 'ticketmaster-attraction' };
    }
  } catch {}

  // Source 5: Ticketmaster event search — find event-level promotional images (/dam/e/ or /dam/a/)
  // Useful when attraction has only generic /dam/c/ images but events have real promotional photos
  try {
    const data = await fetchJSON(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&keyword=${encodeURIComponent(name)}&size=5&sort=date,asc`);
    for (const evt of (data._embedded?.events || [])) {
      const imgs = (evt.images || []).filter(i => i.url && !/ticketm\.net\/dam\/c\//.test(i.url));
      const best = imgs.filter(i => i.ratio === '16_9').sort((x, y) => (y.width || 0) - (x.width || 0))[0]
        || imgs.sort((x, y) => (y.width || 0) - (x.width || 0))[0];
      if (best?.url) return { url: best.url, source: 'ticketmaster-event' };
    }
  } catch {}

  return null;
}

// ---- Step 2b: Scrape Gotham Comedy Club ----
async function scrapeGotham() {
  log('Scraping Gotham Comedy Club...');
  try {
    const data = await fetchJSON('https://api-cache.squadup.com/api/v3/events?page_size=600&user_ids=9987142&include=price_tiers');
    const events = (data.data || [])
      .filter(evt => evt.attributes && new Date(evt.attributes.start_date) >= new Date())
      .map(evt => {
        const attr = evt.attributes;
        const dt = new Date(attr.start_date);
        const date = dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
        const title = (attr.name || '').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '');
        const tiers = evt.relationships?.price_tiers?.data || [];
        const prices = tiers.map(t => {
          const included = data.included?.find(i => i.id === t.id && i.type === 'price_tiers');
          return included?.attributes?.price || null;
        }).filter(Boolean);
        const minPrice = prices.length > 0 ? Math.min(...prices) : null;
        return {
          title, date, time, venue: 'Gotham Comedy Club', price: minPrice,
          url: `https://gothamcomedyclub.com/events?e=${evt.id}`,
          description: (attr.description || '').replace(/<[^>]+>/g, '').substring(0, 200),
          image: attr.image_thumbnail || attr.image || ''
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    log(`Gotham: ${events.length} shows`);
    return events;
  } catch (e) {
    log(`Gotham: ERROR - ${e.message}`);
    return [];
  }
}

// ---- Step 2c: Scrape NYCC ----
// NOTE: NYCC site is JS-rendered — this scraper gets minimal data.
// Would need Puppeteer/Playwright for full scrape. Kept as-is since it's harmless.
async function scrapeNYCC() {
  log('Scraping NY Comedy Club...');
  try {
    const html = await fetchText('https://newyorkcomedyclub.com/shows');
    const shows = [];
    const seen = new Set();
    // Try show cards
    const cardPattern = /href="(\/shows\/[^"]+)"[^>]*>[\s\S]*?<h\d[^>]*>([\s\S]*?)<\/h\d>[\s\S]*?(?:<time[^>]*>([\s\S]*?)<\/time>)?/g;
    let match;
    while ((match = cardPattern.exec(html)) !== null) {
      const p = match[1];
      if (seen.has(p)) continue;
      seen.add(p);
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const dateStr = match[3] ? match[3].replace(/<[^>]+>/g, '').trim() : '';
      if (title) shows.push({ title, date: dateStr, time: '', comedians: [], url: 'https://newyorkcomedyclub.com' + p, venue: 'NY Comedy Club', room: '' });
    }
    // Fallback: extract show links
    if (shows.length === 0) {
      const linkPattern = /href="(\/shows\/([^"]+))"[^>]*>/g;
      while ((match = linkPattern.exec(html)) !== null) {
        const p = match[1]; const slug = match[2];
        if (seen.has(p)) continue;
        seen.add(p);
        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        shows.push({ title, date: '', time: '', comedians: [], url: 'https://newyorkcomedyclub.com' + p, venue: 'NY Comedy Club', room: '' });
      }
    }
    log(`NYCC: ${shows.length} shows`);
    return shows;
  } catch (e) {
    log(`NYCC: ERROR - ${e.message}`);
    return [];
  }
}

// ---- Step 2d: Scrape Big Shows (SeatGeek) ----
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID || 'MTA3MDA0Nzh8MTc3NDMxMTgyMy45ODI2NDY3';

async function scrapeBigShows() {
  log('Scraping Big Shows (SeatGeek)...');
  try {
    const data = await fetchJSON(`https://api.seatgeek.com/2/events?client_id=${SEATGEEK_CLIENT_ID}&venue.city=New+York&taxonomies.name=comedy&per_page=50&sort=datetime_local.asc`);
    // SeatGeek occasionally cross-classifies music/theater events under comedy
    // (e.g. Loudon Wainwright III tagged "theater,comedy" but performers are "concert").
    // Require at least one performer tagged as a comedian.
    const rawEvents = data.events || [];
    const filteredByPerformer = rawEvents.filter(evt => {
      const performers = evt.performers || [];
      if (performers.length === 0) return true;
      return performers.some(p => (p.taxonomies || []).some(t => t.name === 'comedy'));
    });
    const droppedNonComedy = rawEvents.length - filteredByPerformer.length;
    if (droppedNonComedy > 0) log(`Big Shows: dropped ${droppedNonComedy} non-comedy events (no performer tagged comedy)`);
    const events = filteredByPerformer.map(evt => {
      const dt = new Date(evt.datetime_local);
      return {
        title: evt.short_title || evt.title,
        date: evt.datetime_local?.split('T')[0] || '',
        time: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        venue: evt.venue?.name || '',
        performers: (evt.performers || []).map(p => p.name).join(', '),
        performerImages: (evt.performers || []).reduce((acc, p) => {
          const attr = (p.image_attribution || '').toLowerCase();
          if (p.image && !p.image.includes('/generic-comedy') && !attr.startsWith('seatgeek')) acc[p.name] = p.image;
          return acc;
        }, {}),
        price: evt.stats?.lowest_price || null,
        url: evt.url || '',
        id: evt.id,
        source: 'seatgeek',
        // SeatGeek free API doesn't expose listing counts, but check stats if available
        soldout: evt.stats?.listing_count === 0 || false
      };
    });
    log(`Big Shows: ${events.length} events`);
    return events;
  } catch (e) {
    log(`Big Shows: ERROR - ${e.message}`);
    return [];
  }
}

// ---- Step 2e: Scrape Ticketmaster ----
const TM_API_KEY = process.env.TM_API_KEY || 'ngUmt60hJ6lHzJxzy9ximMn0HtAts4Cj';

async function scrapeTicketmaster() {
  log('Scraping Ticketmaster...');
  try {
    const data = await fetchJSON(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&classificationName=comedy&subGenreId=KZazBEonSMnZfZ7vF17&city=New+York&stateCode=NY&size=50&sort=date,asc`);
    const events = (data._embedded?.events || []).map(evt => {
      const startDate = evt.dates?.start?.localDate || '';
      const startTime = evt.dates?.start?.localTime || '';
      const dt = startTime ? new Date(`${startDate}T${startTime}`) : null;
      const venue = evt._embedded?.venues?.[0];

      const performerImages = {};
      (evt._embedded?.attractions || []).forEach(a => {
        const imgs = (a.images || []).filter(i => {
          // Filter out Ticketmaster generic category images (/dam/c/ = category, /dam/a/ = artist)
          if (i.url && /ticketm\.net\/dam\/c\//.test(i.url)) return false;
          return true;
        });
        const best = imgs.filter(i => i.ratio === '16_9').sort((x, y) => (y.width || 0) - (x.width || 0))[0]
          || imgs.sort((x, y) => (y.width || 0) - (x.width || 0))[0];
        if (best?.url) performerImages[a.name] = best.url;
      });

      // Event-level image (promotional poster/photo — /dam/e/ or /dam/a/, not /dam/c/)
      const evtImgs = (evt.images || []).filter(i => i.url && !/ticketm\.net\/dam\/c\//.test(i.url));
      const bestEvtImg = evtImgs.filter(i => i.ratio === '16_9').sort((x, y) => (y.width || 0) - (x.width || 0))[0]
        || evtImgs.sort((x, y) => (y.width || 0) - (x.width || 0))[0];
      const eventImage = bestEvtImg?.url || '';

      // Ticketmaster status: "onsale", "offsale", "cancelled", "rescheduled", "postponed"
      const statusCode = evt.dates?.status?.code || '';
      const soldout = statusCode === 'offsale' || statusCode === 'cancelled';

      return {
        title: evt.name || '',
        date: startDate,
        time: dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
        venue: venue?.name || '',
        performers: (evt._embedded?.attractions || []).map(a => a.name).join(', '),
        performerImages,
        eventImage,
        price: evt.priceRanges?.[0]?.min || null,
        url: evt.url || '',
        id: evt.id,
        source: 'ticketmaster',
        soldout
      };
    });
    log(`Ticketmaster: ${events.length} events`);
    return events;
  } catch (e) {
    log(`Ticketmaster: ERROR - ${e.message}`);
    return [];
  }
}

// Non-comedy acts that get scraped due to broad Ticketmaster/SeatGeek classification
const BIG_SHOWS_BLOCKLIST = [
  'dj akademiks',
];

// ---- Dedupe SeatGeek + Ticketmaster events ----
function mergeEvents(seatgeekEvents, ticketmasterEvents) {
  // Build lookup from SeatGeek: normalize title+date → index in merged array
  const sgKeyToIndex = new Map();
  const merged = seatgeekEvents.map(evt => {
    // Initialize ticketLinks with the SeatGeek source
    return { ...evt, ticketLinks: [{ source: 'seatgeek', url: evt.url }] };
  });

  merged.forEach((evt, idx) => {
    const titleKey = `${evt.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`;
    sgKeyToIndex.set(titleKey, idx);
    if (evt.performers) {
      evt.performers.split(', ').forEach(p => {
        sgKeyToIndex.set(`${p.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`, idx);
      });
    }
  });

  // Add TM events: if duplicate, attach TM URL to existing event; if unique, add as new
  let added = 0, linked = 0;
  ticketmasterEvents.forEach(evt => {
    const titleKey = `${evt.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`;
    const performerKeys = evt.performers
      ? evt.performers.split(', ').map(p => `${p.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`)
      : [];

    // Find matching SeatGeek event
    let matchIdx = sgKeyToIndex.get(titleKey);
    if (matchIdx === undefined) {
      for (const k of performerKeys) {
        matchIdx = sgKeyToIndex.get(k);
        if (matchIdx !== undefined) break;
      }
    }
    // Fuzzy match: check if SG performer's name words appear at the start of TM title
    // Handles spelling variations like SG "Ruslan Bely" vs TM "RUSLAN BELIY STAND UP SHOW"
    if (matchIdx === undefined) {
      const tmWords = evt.title.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
      const tmDate = evt.date;
      for (const [sgKey, sgIdx] of sgKeyToIndex) {
        const [sgName, sgDate] = sgKey.split('|');
        if (sgDate !== tmDate) continue;
        const sgEvt = merged[sgIdx];
        const sgPerformerWords = (sgEvt.performers || sgEvt.title).toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(w => w.length >= 3);
        if (sgPerformerWords.length < 2) continue;
        const tmStart = tmWords.slice(0, sgPerformerWords.length + 2);
        // Fuzzy word compare: shared first N chars, tolerant of 1-char spelling differences
        const allMatch = sgPerformerWords.every(w => tmStart.some(tw => {
          if (tw === w) return true;
          const min = Math.min(tw.length, w.length);
          let shared = 0; for (let i = 0; i < min; i++) { if (tw[i] === w[i]) shared++; }
          return shared >= 3 && shared >= min - 1;
        }));
        if (allMatch) {
          matchIdx = sgIdx;
          break;
        }
      }
    }

    if (matchIdx !== undefined) {
      // Duplicate — attach Ticketmaster URL if not already linked
      const alreadyHasTM = merged[matchIdx].ticketLinks.some(l => l.source === 'ticketmaster');
      if (!alreadyHasTM) {
        merged[matchIdx].ticketLinks.push({ source: 'ticketmaster', url: evt.url });
        linked++;
      }
      // Also grab TM price/soldout/eventImage if SG doesn't have it
      if (!merged[matchIdx].price && evt.price) merged[matchIdx].price = evt.price;
      if (evt.soldout && !merged[matchIdx].soldout) merged[matchIdx].soldout = evt.soldout;
      if (!merged[matchIdx].eventImage && evt.eventImage) merged[matchIdx].eventImage = evt.eventImage;
      if (!merged[matchIdx].time && evt.time) merged[matchIdx].time = evt.time;
      if (!merged[matchIdx].venue && evt.venue) merged[matchIdx].venue = evt.venue;
    } else {
      // Unique TM event — add with ticketLinks
      merged.push({ ...evt, ticketLinks: [{ source: 'ticketmaster', url: evt.url }] });
      added++;
    }
  });
  // Filter out non-comedy acts
  const filtered = merged.filter(evt => {
    const title = (evt.title || '').toLowerCase();
    const performers = (evt.performers || '').toLowerCase();
    return !BIG_SHOWS_BLOCKLIST.some(b => title.includes(b) || performers.includes(b));
  });
  const blockedCount = merged.length - filtered.length;
  log(`Merge: ${seatgeekEvents.length} SeatGeek + ${ticketmasterEvents.length} Ticketmaster → ${linked} linked (multi-source), ${added} unique TM added → ${filtered.length} total${blockedCount ? ` (${blockedCount} blocked)` : ''}`);
  return filtered;
}

// ---- Step 4: Download image ----
async function downloadPhoto(url, filename) {
  try {
    const buffer = await fetch(url);
    if (buffer.length < 500) return null; // too small, probably error page

    // Reject tiny images (SeatGeek generic thumbnails are 280x210 / ~5-8KB)
    if (buffer.length < 10000) {
      log(`  Rejected ${filename}: too small (${buffer.length} bytes)`);
      return null;
    }

    // Check image dimensions from headers
    if (buffer[0] === 0x89 && buffer[1] === 0x50) { // PNG
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      // Reject Instagram icons (large square PNGs)
      if (w === h && w > 2000 && buffer.length > 500000) {
        log(`  Rejected ${filename}: suspicious icon (${w}x${h}, ${buffer.length} bytes)`);
        return null;
      }
      // Reject tiny PNGs
      if (w < 300 && h < 300) {
        log(`  Rejected ${filename}: too small (${w}x${h})`);
        return null;
      }
    } else if (buffer[0] === 0xFF && buffer[1] === 0xD8) { // JPEG
      // Parse JPEG SOF marker for dimensions
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const h = buffer.readUInt16BE(offset + 5);
          const w = buffer.readUInt16BE(offset + 7);
          if (w < 300 && h < 300) {
            log(`  Rejected ${filename}: too small (${w}x${h})`);
            return null;
          }
          break;
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }

    // If already exists as any format, skip
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest[filename]) return manifest[filename];

    // Save in original format (no conversion dependency needed)
    const ext = guessExtension(url, buffer);
    const finalPath = path.join(PHOTOS_DIR, `${filename}${ext}`);
    fs.writeFileSync(finalPath, buffer);
    return ext;
  } catch (e) {
    log(`  Download failed for ${filename}: ${e.message}`);
    return null;
  }
}

function guessExtension(url, buffer) {
  // Check URL
  const urlExt = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  if (urlExt) return '.' + urlExt[1].toLowerCase().replace('jpeg', 'jpg');

  // Check magic bytes
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return '.jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return '.png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return '.webp';

  return '.jpg'; // default
}

// ---- Step 5a: Fetch Stand bio from profile page ----
async function fetchStandBio(name) {
  try {
    const slug = nameToSlug(name);
    const html = await fetchText(`https://thestandnyc.com/comedians/${slug}`);
    // Bio is bare text (5+ tabs indent) after show listings, possibly multi-paragraph
    const match = html.match(/\n\n\t{4,}([A-Z](?:[^\n]|\n(?!\s*<\/div>))+)/s);
    if (!match) return null;
    let bio = match[1].trim()
      .replace(/[\t]+/g, ' ')
      .replace(/\n\s*\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ');
    if (bio.length < 30) return null;
    return bio;
  } catch {
    return null;
  }
}

// ---- Step 5b: Fetch Wikipedia bio ----
async function fetchWikiBio(name) {
  try {
    const encoded = encodeURIComponent(name.replace(/\s+/g, '_'));
    const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    if (!data.extract) return null;

    // Verify it's about a comedian/performer
    const text = data.extract.toLowerCase();
    const isComedian = /comedian|comedy|stand-up|tv show|podcast|actor|actress|writer|improv|sketch|snl|netflix|hbo|late night|tonight show/i.test(text);
    if (!isComedian) return null;

    return data.extract.slice(0, 300);
  } catch {
    return null;
  }
}

// ---- Generic bio filter ----
function isGenericBio(bio) {
  if (!bio || bio.length < 10) return true;
  const lower = bio.toLowerCase();
  // Pure template bios
  if (/^[\w\s.'-]+ is a (stand-up )?comedian/.test(lower) && bio.length < 80) return true;
  if (/^[\w\s.'-]+ is a regular at/.test(lower)) return true;
  // Filler patterns (no real content)
  if (/performs regularly|regular at|clubs across the city|comedy circuit|nyc comedy scene|performing on the/.test(lower) && bio.length < 200) return true;
  if (/hosts? the .+ podcast/.test(lower) && !/netflix|hbo|comedy central|snl|tonight show|late night|conan|fallon|kimmel|colbert|daily show|album|special|award|festival/i.test(lower) && bio.length < 150) return true;
  // Has real credits? Keep it
  if (/netflix|hbo|comedy central|snl|saturday night|tonight show|late night|conan|fallon|kimmel|colbert|letterman|daily show|imdb/i.test(bio)) return false;
  // Short + generic pattern
  if (/^[\w\s.'-]+ is a comedian/.test(lower) && bio.length < 120) return true;
  return false;
}

// ---- Scrape Comedy Cellar availability (sold out detection) ----
async function scrapeAvailability() {
  try {
    // Step 1: Get auth token from reservation page
    const page = await fetch('https://www.comedycellar.com/reservations-newyork/');
    const html = page.toString();
    const configMatch = html.match(/ccgrfConfig\s*=\s*(\{.*?\});/s);
    if (!configMatch) { log('Availability: could not extract cca token'); return {}; }
    const config = JSON.parse(configMatch[1]);
    const { cca, created } = config;

    // Step 2: Fetch availability for next 7 days
    const dates = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const results = {};
    await Promise.all(dates.map(async dateStr => {
      try {
        const resp = await fetchPost(
          'https://www.comedycellar.com/reservations/api/getShows',
          { date: dateStr },
          { 'X-Code-Localize': cca, 'X-Page-Creation': String(created) }
        );
        const data = JSON.parse(resp.toString());
        const shows = data?.data?.showInfo?.shows || [];
        results[dateStr] = shows.map(s => ({
          time: s.time,
          description: s.description,
          soldout: s.soldout || (s.max - s.totalGuests < 1),
          seatsLeft: Math.max(0, s.max - s.totalGuests),
          cover: s.cover,
          timestamp: s.timestamp
        }));
      } catch (e) {
        log(`Availability: failed for ${dateStr}: ${e.message}`);
        results[dateStr] = [];
      }
    }));

    const totalSoldOut = Object.values(results).flat().filter(s => s.soldout).length;
    const totalShows = Object.values(results).flat().length;
    log(`Availability: ${totalShows} shows across ${dates.length} days, ${totalSoldOut} sold out`);
    return results;
  } catch (e) {
    log(`Availability scrape failed: ${e.message}`);
    return {};
  }
}

// ---- Main ----
async function main() {
  const startTime = Date.now();
  log('=== PREBAKE START ===');

  // Load existing data
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch {}
  let comedianDB = [];
  try { comedianDB = JSON.parse(fs.readFileSync(COMEDIANS_PATH, 'utf8')); } catch {}
  const dbByName = new Map(comedianDB.map(c => [c.name, c]));

  // Scrape all sources in parallel
  const [cellarResult, standResult, gothamShows, nyccShows, seatgeekEvents, ticketmasterEvents, availability] = await Promise.all([
    scrapeCellar(),
    scrapeStand(),
    scrapeGotham(),
    scrapeNYCC(),
    scrapeBigShows(),
    scrapeTicketmaster(),
    scrapeAvailability(),
  ]);

  // Merge SeatGeek + Ticketmaster, deduplicating by title+date
  const bigShowEvents = mergeEvents(seatgeekEvents, ticketmasterEvents);

  const { comedians: cellarComedians, batchResults, dates: cellarDates } = cellarResult;
  const { comedians: standComedians, shows: standShows } = standResult;

  // Save all show data as static JSON files (served from CDN, zero function invocations)
  const CACHE_DIR = path.join(ROOT, 'public', 'data');

  // Cellar batch — same format as /api/lineup-batch response
  fs.writeFileSync(path.join(CACHE_DIR, 'cellar-cache.json'), JSON.stringify({
    results: batchResults, dates: cellarDates, count: cellarDates.length,
    prebaked: new Date().toISOString()
  }) + '\n');
  log(`Saved cellar-cache.json (${cellarDates.length} days)`);

  // Stand shows — same format as /api/the-stand response
  fs.writeFileSync(path.join(CACHE_DIR, 'stand-cache.json'), JSON.stringify({
    shows: standShows, count: standShows.length, source: 'thestandnyc.com',
    prebaked: new Date().toISOString()
  }) + '\n');
  log(`Saved stand-cache.json (${standShows.length} shows)`);

  // Gotham — same format as /api/gotham response
  fs.writeFileSync(path.join(CACHE_DIR, 'gotham-cache.json'), JSON.stringify({
    shows: gothamShows, count: gothamShows.length, source: 'gothamcomedyclub.com',
    prebaked: new Date().toISOString()
  }) + '\n');
  log(`Saved gotham-cache.json (${gothamShows.length} shows)`);

  // NYCC — same format as /api/nycc response
  fs.writeFileSync(path.join(CACHE_DIR, 'nycc-cache.json'), JSON.stringify({
    shows: nyccShows, count: nyccShows.length, source: 'newyorkcomedyclub.com',
    prebaked: new Date().toISOString()
  }) + '\n');
  log(`Saved nycc-cache.json (${nyccShows.length} shows)`);

  // Big Shows — same format as /api/big-shows response
  fs.writeFileSync(path.join(CACHE_DIR, 'big-shows-cache.json'), JSON.stringify({
    events: bigShowEvents, count: bigShowEvents.length, source: 'seatgeek.com+ticketmaster.com',
    prebaked: new Date().toISOString()
  }) + '\n');
  log(`Saved big-shows-cache.json (${bigShowEvents.length} events)`);

  // Availability — sold out status per show per day
  fs.writeFileSync(path.join(CACHE_DIR, 'availability-cache.json'), JSON.stringify({
    availability, prebaked: new Date().toISOString()
  }) + '\n');
  const totalSoldOut = Object.values(availability).flat().filter(s => s.soldout).length;
  log(`Saved availability-cache.json (${totalSoldOut} sold out)`);

  // Merge all comedian names + photo URLs
  const allComedians = new Map(); // name -> { photoUrl, tagline, source }
  for (const [name, data] of cellarComedians) {
    allComedians.set(name, { ...data });
  }
  for (const [name, data] of standComedians) {
    if (!allComedians.has(name)) {
      allComedians.set(name, { ...data });
    } else if (!allComedians.get(name).photoUrl && data.photoUrl) {
      allComedians.get(name).photoUrl = data.photoUrl;
    }
  }

  // Add Big Show performers to photo pipeline
  for (const evt of bigShowEvents) {
    const performers = (evt.performers || '').split(',').map(p => p.split(' - ')[0].trim()).filter(Boolean);
    for (const name of performers) {
      if (allComedians.has(name)) continue;
      // Get best performer image, filtering out generic Ticketmaster category images (/dam/c/)
      let photoUrl = '';
      if (evt.performerImages?.[name]) {
        const url = evt.performerImages[name];
        if (!url.includes('/dam/c/')) photoUrl = url; // /dam/c/ = TM category placeholder
      }
      // Fall back to event-level image (promotional poster from Ticketmaster)
      if (!photoUrl && evt.eventImage) photoUrl = evt.eventImage;
      allComedians.set(name, { photoUrl, tagline: '', source: evt.source || 'big-show' });
    }
  }

  log(`Total unique comedians across all sources: ${allComedians.size}`);

  // Find comedians missing local photos
  let downloadCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const [name, data] of allComedians) {
    const filename = nameToFilename(name);
    if (manifest[filename]) {
      skipCount++;
      continue; // Already have a local photo
    }

    // Try the scraped photo URL first
    if (data.photoUrl) {
      // Skip SeatGeek placeholders
      if (data.photoUrl.includes('seatgeek.com') && /placeholder|generic/i.test(data.photoUrl)) {
        // Skip placeholder
      } else {
        const ext = await downloadPhoto(data.photoUrl, filename);
        if (ext) {
          manifest[filename] = ext;
          downloadCount++;
          log(`  Downloaded: ${name} (${ext}) from ${data.source || 'scraped'}`);
          continue;
        }
      }
    }

    // Try additional sources (Stand profile, NYCC profile, Instagram)
    const found = await findPhoto(name);
    if (found) {
      const ext = await downloadPhoto(found.url, filename);
      if (ext) {
        manifest[filename] = ext;
        downloadCount++;
        log(`  Downloaded: ${name} (${ext}) from ${found.source}`);
        continue;
      }
    }

    failCount++;
  }

  log(`Photos — downloaded: ${downloadCount}, skipped (already local): ${skipCount}, not found: ${failCount}`);

  // Update bios for comedians missing them in the DB
  let bioCount = 0;
  let standBioCount = 0;
  for (const [name, data] of allComedians) {
    const existing = dbByName.get(name);

    // Add to DB if not present
    if (!existing) {
      const newEntry = { name, venues: [] };
      if (data.tagline && !isGenericBio(data.tagline)) {
        newEntry.bio = data.tagline;
      }
      comedianDB.push(newEntry);
      dbByName.set(name, newEntry);
    }

    const entry = dbByName.get(name);

    // Clean up filler bios that passed old filters
    if (entry.bio && isGenericBio(entry.bio)) {
      delete entry.bio;
    }

    // Scrape Stand bio for Stand comedians missing bio_stand
    const isStandComedian = data.source === 'stand' || (entry.venues && entry.venues.includes('the_stand'));
    if (isStandComedian && !entry.bio_stand) {
      const standBio = await fetchStandBio(name);
      if (standBio && !isGenericBio(standBio)) {
        entry.bio_stand = standBio;
        standBioCount++;
      }
    }

    // Try Wikipedia for comedians with no bio at all
    const hasBio = entry.bio || entry.bio_stand;
    if (!hasBio) {
      const wikiBio = await fetchWikiBio(name);
      if (wikiBio && !isGenericBio(wikiBio)) {
        entry.bio_wiki = wikiBio;
        bioCount++;
      }
    }

    // Save Cellar tagline if we have one and it's better
    if (data.tagline && !isGenericBio(data.tagline)) {
      if (!entry.tagline_cellar || data.tagline.length > (entry.tagline_cellar || '').length) {
        entry.tagline_cellar = data.tagline;
      }
    }
  }

  log(`Bios — Stand profiles: ${standBioCount}, Wikipedia: ${bioCount}`);

  // Enrich Big Shows performerImages with local photos or eventImage for events missing images
  let enrichedCount = 0;
  for (const evt of bigShowEvents) {
    const performers = (evt.performers || '').split(',').map(p => p.split(' - ')[0].trim()).filter(Boolean);
    let hasAnyPhoto = Object.keys(evt.performerImages || {}).length > 0;
    for (const name of performers) {
      if (evt.performerImages[name]) continue; // already has an API image
      const filename = nameToFilename(name);
      if (manifest[filename]) {
        evt.performerImages[name] = `/photos/${filename}${manifest[filename]}`;
        enrichedCount++;
        hasAnyPhoto = true;
      }
    }
    // Last resort: use eventImage (TM promotional poster) if no performer photo found
    if (!hasAnyPhoto && evt.eventImage && performers.length > 0) {
      evt.performerImages[performers[0]] = evt.eventImage;
      enrichedCount++;
    }
  }
  if (enrichedCount > 0) {
    log(`Enriched ${enrichedCount} Big Shows performers with local photos`);
    // Re-write big-shows-cache.json with enriched images
    fs.writeFileSync(path.join(CACHE_DIR, 'big-shows-cache.json'), JSON.stringify({
      events: bigShowEvents, count: bigShowEvents.length, source: 'seatgeek.com+ticketmaster.com',
      prebaked: new Date().toISOString()
    }) + '\n');
  }

  // ---- Step 7: Self-healing Wikipedia gap-fill ----
  // For every comedian still missing a bio or photo (across all sources +
  // local blob), hit Wikipedia REST and fill bio_wiki / photo_wiki.
  // NEVER overwrites existing fields. Failures are logged and swallowed
  // so a Wikipedia outage cannot break the prebake.
  try {
    // Tight disambiguation: require comedy person-noun, reject TV series/film/album extracts,
    // require last-name token in extract (avoids Jake Silberman → Silbermann mismatches).
    const COMEDIAN_RE = /\b(comedian|stand-up|stand up|comic\b|comedy festival|sketch comedy|comedy central|saturday night live|snl writer|conan o'brien|tonight show)\b/i;
    const NOT_PERSON_RE = /\bis an? (american|british|canadian|australian|irish|new zealand)?\s*(television series|tv series|sitcom|drama|crime drama|film|movie|album|song|video game|book|novel|play|musical|reality (show|series)|podcast series)\b/i;
    const lastTok = (name) => {
      const parts = name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/[^a-z\s]/gi, ' ').trim().split(/\s+/);
      return parts.length ? parts[parts.length - 1].toLowerCase() : '';
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function wikiSummary(name, allowVariant = true) {
      try {
        const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
        const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
        if (!data || data.type === 'disambiguation' || !data.extract) {
          if (allowVariant) { await sleep(100); return wikiSummary(`${name} (comedian)`, false); }
          return null;
        }
        const extract = data.extract;
        if (NOT_PERSON_RE.test(extract)) {
          if (allowVariant) { await sleep(100); return wikiSummary(`${name} (comedian)`, false); }
          return null;
        }
        if (!COMEDIAN_RE.test(extract.toLowerCase())) {
          if (allowVariant) { await sleep(100); return wikiSummary(`${name} (comedian)`, false); }
          return null;
        }
        const last = lastTok(name);
        if (last && last.length >= 3 && !extract.toLowerCase().includes(last)) {
          if (allowVariant) { await sleep(100); return wikiSummary(`${name} (comedian)`, false); }
          return null;
        }
        return { bio: extract.substring(0, 300), photo: data.thumbnail?.source || '' };
      } catch {
        return null;
      }
    }

    const blobs = new Set(fs.readdirSync(path.join(ROOT, 'public', 'photos')));
    let scanned = 0, addedBios = 0, addedPhotos = 0;
    for (const c of comedianDB) {
      const hasBio = c.bio || c.bio_stand || c.bio_wiki || c.tagline_cellar;
      const hasPhotoUrl = c.photo_nycc || c.photo_stand || c.photo_cellar || c.photo_wiki;
      let hasBlob = false;
      if (!hasPhotoUrl) {
        const fn = nameToFilename(c.name);
        hasBlob = ['jpg', 'jpeg', 'png', 'webp'].some(ext => blobs.has(`${fn}.${ext}`));
      }
      const needBio = !hasBio;
      const needPhoto = !hasPhotoUrl && !hasBlob;
      if (!needBio && !needPhoto) continue;
      scanned++;
      const w = await wikiSummary(c.name);
      if (w) {
        if (needBio && w.bio && !c.bio_wiki) { c.bio_wiki = w.bio; addedBios++; }
        if (needPhoto && w.photo && !c.photo_wiki) { c.photo_wiki = w.photo; addedPhotos++; }
      }
      await sleep(100);
    }
    log(`🩹 Gap-fill: scanned ${scanned}, added ${addedBios} bios, ${addedPhotos} photos`);
  } catch (e) {
    log(`Gap-fill skipped (error): ${e.message}`);
  }

  // Sort manifest alphabetically for clean diffs
  const sortedManifest = {};
  for (const key of Object.keys(manifest).sort()) {
    sortedManifest[key] = manifest[key];
  }

  // Write updated files
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(sortedManifest, null, 2) + '\n');
  fs.writeFileSync(COMEDIANS_PATH, JSON.stringify(comedianDB, null, 2) + '\n');

  log(`Manifest: ${Object.keys(sortedManifest).length} entries`);
  log(`Comedian DB: ${comedianDB.length} entries`);

  // Git commit/push handled by GitHub Actions workflow (not this script)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`=== PREBAKE DONE in ${elapsed}s ===\n`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});

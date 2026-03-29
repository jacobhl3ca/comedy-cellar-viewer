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
};

function normalizeName(name) {
  const clean = name.replace(/<[^>]+>/g, '').trim();
  return NAME_FIXES[clean] || clean;
}

function nameToSlug(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '');
}

function nameToFilename(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
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
          .map(m => m[1].trim())
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

        allShows.push({ title, date, time, comedians: names, url: showUrl, venue: 'The Stand NYC', room, price, poster, comedianPhotos });

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

  // Source 3: Instagram og:image
  try {
    const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const usernames = [
        `${first}${last}`, `${first}.${last}`, `${first}_${last}`,
        `${first}${last}comedy`, `${first}comedy`,
      ];
      for (const username of usernames) {
        try {
          const html = await fetchText(`https://www.instagram.com/${username}/`);
          if (!html.includes('og:image')) continue;
          const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
                     || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
          if (match && match[1] && match[1].includes('cdninstagram.com')) {
            return { url: match[1].replace(/&amp;/g, '&'), source: 'instagram' };
          }
        } catch {}
      }
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
const SEATGEEK_CLIENT_ID = 'MTA3MDA0Nzh8MTc3NDMxMTgyMy45ODI2NDY3';

async function scrapeBigShows() {
  log('Scraping Big Shows (SeatGeek)...');
  try {
    const data = await fetchJSON(`https://api.seatgeek.com/2/events?client_id=${SEATGEEK_CLIENT_ID}&venue.city=New+York&taxonomies.name=comedy&per_page=50&sort=datetime_local.asc`);
    const events = (data.events || []).map(evt => {
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
        id: evt.id
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
const TM_API_KEY = 'ngUmt60hJ6lHzJxzy9ximMn0HtAts4Cj';

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
        const imgs = a.images || [];
        const best = imgs.filter(i => i.ratio === '16_9').sort((x, y) => (y.width || 0) - (x.width || 0))[0]
          || imgs.sort((x, y) => (y.width || 0) - (x.width || 0))[0];
        if (best?.url) performerImages[a.name] = best.url;
      });

      return {
        title: evt.name || '',
        date: startDate,
        time: dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
        venue: venue?.name || '',
        performers: (evt._embedded?.attractions || []).map(a => a.name).join(', '),
        performerImages,
        price: evt.priceRanges?.[0]?.min || null,
        url: evt.url || '',
        id: evt.id,
        source: 'ticketmaster'
      };
    });
    log(`Ticketmaster: ${events.length} events`);
    return events;
  } catch (e) {
    log(`Ticketmaster: ERROR - ${e.message}`);
    return [];
  }
}

// ---- Dedupe SeatGeek + Ticketmaster events ----
function mergeEvents(seatgeekEvents, ticketmasterEvents) {
  // Build lookup from SeatGeek: normalize title+date for matching
  const sgKeys = new Set();
  seatgeekEvents.forEach(evt => {
    sgKeys.add(`${evt.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`);
    // Also match on performer name for cases where titles differ
    if (evt.performers) {
      evt.performers.split(', ').forEach(p => {
        sgKeys.add(`${p.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`);
      });
    }
  });

  // Add TM events that aren't already in SeatGeek
  let added = 0;
  const merged = [...seatgeekEvents];
  ticketmasterEvents.forEach(evt => {
    const titleKey = `${evt.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`;
    const performerKeys = evt.performers
      ? evt.performers.split(', ').map(p => `${p.toLowerCase().replace(/[^a-z0-9]/g, '')}|${evt.date}`)
      : [];
    const isDupe = sgKeys.has(titleKey) || performerKeys.some(k => sgKeys.has(k));
    if (!isDupe) {
      merged.push(evt);
      added++;
    }
  });
  log(`Merge: ${seatgeekEvents.length} SeatGeek + ${ticketmasterEvents.length} Ticketmaster → ${added} unique TM events added → ${merged.length} total`);
  return merged;
}

// ---- Step 4: Download image ----
async function downloadPhoto(url, filename) {
  try {
    const buffer = await fetch(url);
    if (buffer.length < 500) return null; // too small, probably error page

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

// ---- Step 5: Fetch Wikipedia bio ----
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
  // Has real credits? Keep it
  if (/netflix|hbo|comedy central|snl|saturday night|tonight show|late night|conan|fallon|kimmel|colbert|letterman|daily show|imdb/i.test(bio)) return false;
  // Short + generic pattern
  if (/^[\w\s.'-]+ is a comedian/.test(lower) && bio.length < 120) return true;
  return false;
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
  const [cellarResult, standResult, gothamShows, nyccShows, seatgeekEvents, ticketmasterEvents] = await Promise.all([
    scrapeCellar(),
    scrapeStand(),
    scrapeGotham(),
    scrapeNYCC(),
    scrapeBigShows(),
    scrapeTicketmaster(),
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

    // Try Wikipedia for comedians with no bio at all
    const entry = dbByName.get(name);
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

  log(`Bios — fetched from Wikipedia: ${bioCount}`);

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

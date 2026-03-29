#!/usr/bin/env node
/**
 * Nightly prebake script — runs on Mac Mini at 3am via cron
 *
 * 1. Pulls Comedy Cellar lineups for next 7 days
 * 2. Pulls The Stand shows
 * 3. Extracts all comedian names + external photo URLs
 * 4. Downloads missing photos as local WebP files
 * 5. Fetches missing bios from Wikipedia
 * 6. Updates comedians.json + photo-manifest.json
 * 7. Git commit + push → triggers Vercel deploy
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
async function scrapeCellar() {
  log('Scraping Comedy Cellar lineups...');
  const comedians = new Map(); // name -> { photoUrl, tagline }

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
    }
  }

  log(`Comedy Cellar: found ${comedians.size} comedians`);
  return comedians;
}

// ---- Step 2: Scrape The Stand ----
async function scrapeStand() {
  log('Scraping The Stand...');
  const comedians = new Map(); // name -> { photoUrl }

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

        // Extract comedian names
        const nameMatches = [...block.matchAll(/<small>(.*?)<\/small>/g)];
        const names = [...new Set(nameMatches
          .map(m => m[1].trim())
          .filter(n => n && n.length > 1 && !n.match(/^\$/) && !/^special\s*guests?$/i.test(n) && !/^more\s*tba$/i.test(n))
        )];

        // Extract comedian photos
        const photoMatches = [...block.matchAll(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"[^>]*>/gi)];
        for (const pm of photoMatches) {
          const imgUrl = pm[1];
          const filenameMatch = imgUrl.match(/\/([^/]+)\.(jpg|jpeg|png|webp)$/i);
          if (filenameMatch) {
            const photoName = filenameMatch[1].replace(/_/g, ' ').replace(/-/g, ' ').replace(/\s*\d+$/, '');
            for (const c of names) {
              const cNorm = c.toLowerCase().replace(/[.\-']/g, ' ');
              const pNorm = photoName.toLowerCase();
              if (cNorm === pNorm || pNorm.includes(c.split(' ').pop().toLowerCase())) {
                if (!comedians.has(c)) comedians.set(c, {});
                comedians.get(c).photoUrl = imgUrl;
                comedians.get(c).source = 'stand';
                break;
              }
            }
          }
        }

        // Register names even without photos
        for (const n of names) {
          if (!comedians.has(n)) comedians.set(n, {});
        }
      }
    } catch (e) {
      log(`  Stand offset ${offset}: ERROR - ${e.message}`);
    }
  }

  log(`The Stand: found ${comedians.size} comedians`);
  return comedians;
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

// ---- Step 4: Download image and convert to WebP ----
async function downloadPhoto(url, filename) {
  try {
    const buffer = await fetch(url);
    if (buffer.length < 500) return null; // too small, probably error page

    const tempPath = path.join(PHOTOS_DIR, `${filename}_temp`);
    const outPath = path.join(PHOTOS_DIR, `${filename}.webp`);

    // If already exists as any format, skip
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest[filename]) return manifest[filename];

    fs.writeFileSync(tempPath, buffer);

    // Try to convert to WebP using sips (built into macOS)
    try {
      execSync(`sips -s format webp "${tempPath}" --out "${outPath}" 2>/dev/null`, { timeout: 10000 });
      fs.unlinkSync(tempPath);
      return '.webp';
    } catch {
      // sips WebP support varies — fall back to saving as original format
      const ext = guessExtension(url, buffer);
      const finalPath = path.join(PHOTOS_DIR, `${filename}${ext}`);
      fs.renameSync(tempPath, finalPath);
      return ext;
    }
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

  // Scrape all sources
  const [cellarComedians, standComedians] = await Promise.all([
    scrapeCellar(),
    scrapeStand(),
  ]);

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

  // Git commit + push if there are changes
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
    if (status) {
      execSync('git add public/photos/ public/data/photo-manifest.json public/data/comedians.json', { cwd: ROOT });
      const msg = `Prebake: +${downloadCount} photos, +${bioCount} bios [${new Date().toISOString().split('T')[0]}]`;
      execSync(`git commit -m "${msg}"`, { cwd: ROOT });
      execSync('git push', { cwd: ROOT });
      log(`Git: committed and pushed — "${msg}"`);
    } else {
      log('Git: no changes to commit');
    }
  } catch (e) {
    log(`Git error: ${e.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`=== PREBAKE DONE in ${elapsed}s ===\n`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});

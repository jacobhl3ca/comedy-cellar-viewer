#!/usr/bin/env node
/**
 * Manual recovery for the 4 legends that failed the tightened
 * disambiguation regex (Wikipedia bios for them are valid but
 * didn't pass our last-name + comedy-person-noun guard).
 *
 * Fetches Wikipedia REST summary directly, accepts unconditionally
 * (we've manually verified each name maps to the correct person).
 *
 * Plus 3 photo-less comedians (mike goldstein, James Mwaura,
 * Joseph Vescey) — try NYCC scraping their profile page for
 * the headshot URL since Wikipedia has nothing on them.
 *
 * NEVER overwrites existing fields.
 *
 * Writes BOTH data/comedians.json AND public/data/comedians.json.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_PATHS = [
  path.join(ROOT, 'data', 'comedians.json'),
  path.join(ROOT, 'public', 'data', 'comedians.json'),
];

// Names known to map to the right person on Wikipedia — bypass regex guard.
const MANUAL_LEGENDS = [
  'Marlon Wayans',
  'Reggie Watts',
  'Doug Benson',
  'Jessica Williams (actress)',  // disambiguation needed — Jessica Williams the Daily Show alum
];

// For Jessica Williams, save under the original name (without "(actress)")
const NAME_OVERRIDES = {
  'Jessica Williams (actress)': 'Jessica Williams',
};

// Comedians missing photos — scrape NYCC for headshot
const PHOTO_TARGETS = [
  { name: 'mike goldstein', slug: 'mike-goldstein' },
  { name: 'James Mwaura', slug: 'james-mwaura' },
  { name: 'Joseph Vescey', slug: 'joseph-vescey' },
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'CellarTonight/1.0 (cellartonight.com)' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    }, (resp) => {
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return fetchText(resp.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function manualWikiFetch(name) {
  try {
    const slug = encodeURIComponent(name.replace(/ /g, '_'));
    const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
    if (!data.extract) return null;
    return { bio: data.extract.substring(0, 300), photo: data.thumbnail?.source || '' };
  } catch { return null; }
}

async function nyccPhotoFetch(slug) {
  try {
    const html = await fetchText(`https://newyorkcomedyclub.com/comedians/${slug}`);
    // Find og:image meta
    let m = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (m) return m[1];
    // Find first /img/comedians/ src
    m = html.match(/src="([^"]*\/img\/comedians\/[^"]+)"/);
    if (m) {
      const url = m[1].startsWith('http') ? m[1] : 'https://newyorkcomedyclub.com' + m[1];
      return url;
    }
    return null;
  } catch { return null; }
}

async function standPhotoFetch(slug) {
  try {
    const html = await fetchText(`https://thestandnyc.com/comedians/${slug}`);
    // Stand uses _square/<slug>.jpg pattern
    let m = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (m) return m[1];
    m = html.match(/src="(\/images\/comedians\/_square\/[^"]+)"/);
    if (m) return 'https://thestandnyc.com' + m[1];
    return null;
  } catch { return null; }
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  const byName = new Map(db.map(c => [c.name.toLowerCase(), c]));

  const added = [], updated = [];
  const failed = [];

  // 1. Manual legends
  for (const wikiName of MANUAL_LEGENDS) {
    const realName = NAME_OVERRIDES[wikiName] || wikiName;
    const w = await manualWikiFetch(wikiName);
    if (!w || !w.bio) { failed.push(realName + ' (Wiki)'); await sleep(150); continue; }

    const existing = byName.get(realName.toLowerCase());
    if (existing) {
      if (!existing.bio_wiki && w.bio) { existing.bio_wiki = w.bio; updated.push(realName + ' (bio)'); }
      if (!existing.photo_wiki && w.photo) { existing.photo_wiki = w.photo; updated.push(realName + ' (photo)'); }
      if (!existing.featured) existing.featured = true;
    } else {
      db.push({
        name: realName,
        featured: true,
        venues: [],
        bio_wiki: w.bio,
        photo_wiki: w.photo || '',
      });
      added.push(realName);
    }
    await sleep(150);
  }

  // 2. Photo-less comedians — try NYCC then Stand
  for (const { name, slug } of PHOTO_TARGETS) {
    const existing = byName.get(name.toLowerCase());
    if (!existing) { failed.push(name + ' (not in DB)'); continue; }
    if (existing.photo_nycc || existing.photo_stand || existing.photo_cellar || existing.photo_wiki) {
      continue; // already has photo
    }
    let photoUrl = await nyccPhotoFetch(slug);
    let src = 'nycc';
    if (!photoUrl) {
      await sleep(150);
      photoUrl = await standPhotoFetch(slug);
      src = 'stand';
    }
    if (!photoUrl) { failed.push(name + ' (no venue photo found)'); await sleep(150); continue; }
    // Reject obvious placeholder URLs
    if (/BlankBackground|placeholder|default-headshot/i.test(photoUrl)) {
      failed.push(name + ' (got placeholder URL: ' + photoUrl + ')');
      await sleep(150); continue;
    }
    const field = src === 'nycc' ? 'photo_nycc' : 'photo_stand';
    existing[field] = photoUrl;
    updated.push(name + ' (' + src + ' photo)');
    await sleep(150);
  }

  // Write back to BOTH paths
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      const localByName = new Map(local.map(c => [c.name.toLowerCase(), c]));
      for (const updated of db) {
        const target = localByName.get(updated.name.toLowerCase());
        if (target) {
          if (updated.featured && !target.featured) target.featured = true;
          if (updated.bio_wiki && !target.bio_wiki) target.bio_wiki = updated.bio_wiki;
          if (updated.photo_wiki && !target.photo_wiki) target.photo_wiki = updated.photo_wiki;
          if (updated.photo_nycc && !target.photo_nycc) target.photo_nycc = updated.photo_nycc;
          if (updated.photo_stand && !target.photo_stand) target.photo_stand = updated.photo_stand;
        } else if (updated.featured && updated.bio_wiki) {
          local.push({
            name: updated.name,
            featured: true,
            venues: [],
            bio_wiki: updated.bio_wiki,
            photo_wiki: updated.photo_wiki || '',
          });
        }
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Manual legends + photo fill ===`);
  console.log('Added (new entries):', added);
  console.log('Updated (existing entries):', updated);
  if (failed.length) console.log('Failed:', failed);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Clean up 7 bio_wiki entries that are Wikipedia disambiguation pages
 * (e.g. "Zakir Khan may refer to:..."). For each, try the "(comedian)"
 * variant and replace if valid. Otherwise blank the bio_wiki field.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function tryComedianVariant(name) {
  const slug = encodeURIComponent(`${name} (comedian)`.replace(/ /g, '_'));
  try {
    const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
    if (!data.extract) return null;
    if (data.type === 'disambiguation') return null;
    // Must mention comedian/stand-up and not be about a TV show etc.
    const x = data.extract.toLowerCase();
    if (!/\b(comedian|stand-up|stand up|comic)\b/.test(x)) return null;
    if (/\bis an? (american|british|canadian|australian|indian|pakistani|irish)?\s*(tv series|television series|film|movie|album|sitcom)\b/i.test(data.extract)) return null;
    return { bio: data.extract.substring(0, 300), photo: data.thumbnail?.source || '' };
  } catch { return null; }
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));

  const fixed = [], blanked = [];

  for (const c of db) {
    const bio = c.bio_wiki || '';
    if (!/\bmay refer to\b/i.test(bio)) continue;
    const variant = await tryComedianVariant(c.name);
    if (variant && variant.bio) {
      c.bio_wiki = variant.bio;
      if (!c.photo_wiki && variant.photo) c.photo_wiki = variant.photo;
      fixed.push(c.name);
    } else {
      delete c.bio_wiki;
      blanked.push(c.name);
    }
    await sleep(150);
  }

  // Mirror to both DBs
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      const idx = new Map(local.map(c => [c.name, c]));
      for (const updated of db) {
        const t = idx.get(updated.name);
        if (!t) continue;
        // Overwrite bio_wiki ONLY for entries we fixed/blanked here
        if (fixed.includes(updated.name) || blanked.includes(updated.name)) {
          if (updated.bio_wiki) t.bio_wiki = updated.bio_wiki;
          else delete t.bio_wiki;
          if (updated.photo_wiki && !t.photo_wiki) t.photo_wiki = updated.photo_wiki;
        }
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`Fixed via (comedian) variant: ${fixed.length}`);
  fixed.forEach(n => console.log('  ' + n));
  console.log(`\nBlanked (no valid variant): ${blanked.length}`);
  blanked.forEach(n => console.log('  ' + n));
})().catch(e => { console.error(e); process.exit(1); });

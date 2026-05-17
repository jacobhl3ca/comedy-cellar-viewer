#!/usr/bin/env node
/**
 * Seed "Comedy Legends" — active touring comedians who play NYC
 * but aren't currently in our DB because they don't have NYCC/Stand
 * profile pages and aren't currently booked.
 *
 * Adds entries with: name, bio_wiki, photo_wiki, featured: true, venues: [].
 *
 * Uses the same tightened disambiguation as gap-fill-bios.js:
 *   - comedy person-noun required
 *   - reject TV-series / film / album extracts
 *   - require last-name token in extract
 *
 * NEVER overwrites existing entries. If a candidate is already in the DB,
 * it just flips `featured: true` on the existing entry — does NOT touch
 * any existing bio/photo/venue fields.
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

// Curated list — active touring comics who play NYC rooms (Cellar, Beacon, Town Hall,
// MSG, Garden Theater, Capital One Hall, etc.). Mix of network late-night, SNL alums,
// pod-comedy stars, big-room headliners, NYC scene staples. ~60 names.
const LEGENDS = [
  // SNL NYC-based
  'Colin Jost', 'Michael Che', 'Bowen Yang', 'Sarah Sherman',
  'Cecily Strong', 'Sasheer Zamata', 'Heidi Gardner', 'Chloe Fineman',
  // Touring big-room headliners
  'Anthony Jeselnik', 'Doug Stanhope', 'Andrew Santino', 'Brian Regan',
  'Marlon Wayans', 'Iliza Shlesinger', 'Whitney Cummings',
  'Nikki Glaser', 'Ali Wong', 'Maria Bamford', 'Tig Notaro',
  'Wanda Sykes', 'Sarah Silverman', 'Patton Oswalt', 'Demetri Martin',
  'Mike Birbiglia', 'Hannibal Buress', 'Aziz Ansari', 'Hasan Minhaj',
  'Trevor Noah', 'Ronny Chieng', 'Roy Wood Jr.',
  // Late-night / talk
  'Stephen Colbert', 'Jimmy Fallon', 'Seth Meyers', 'John Oliver',
  'Conan O\'Brien', 'David Letterman', 'Bill Maher', 'Jimmy Kimmel',
  // Pod-comedy / Joe Rogan-adjacent
  'Bert Kreischer', 'Tom Segura', 'Theo Von', 'Bobby Lee',
  'Tim Dillon', 'Joe Rogan', 'Akaash Singh', 'Andrew Schulz',
  'Ari Shaffir', 'Brendan Schaub',
  // NYC scene Hall of Famers
  'Colin Quinn', 'Jim Norton', 'Hannibal Buress',
  'Reggie Watts', 'Wyatt Cenac', 'Tracy Morgan',
  // Active touring legends
  'Jerry Seinfeld', 'Jim Gaffigan', 'Bill Burr', 'Kevin Hart',
  'Chris Rock', 'Dave Chappelle', 'John Mulaney', 'Sebastian Maniscalco',
  'Pete Davidson', 'Bo Burnham', 'Eddie Murphy', 'Ricky Gervais',
  'Russell Peters', 'Doug Benson', 'Jessica Williams',
];

const COMEDIAN_RE = /\b(comedian|stand-up|stand up|comic\b|comedy festival|sketch comedy|comedy central|saturday night live|snl|conan o'brien|tonight show|talk show host|television host|late-night)\b/i;
const NOT_PERSON_RE = /\bis an? (american|british|canadian|australian|irish|new zealand)?\s*(television series|tv series|sitcom|drama|crime drama|film|movie|album|song|video game|book|novel|play|musical|reality (show|series)|podcast series)\b/i;

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
const lastNameToken = (name) => {
  const parts = name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/[^a-z\s]/gi, ' ').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
};

async function fetchWiki(name, allowVariant = true) {
  const slug = encodeURIComponent(name.replace(/ /g, '_'));
  let data;
  try { data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`); }
  catch { return null; }
  if (!data || data.type === 'disambiguation' || !data.extract) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  const extract = data.extract;
  if (NOT_PERSON_RE.test(extract)) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  if (!COMEDIAN_RE.test(extract.toLowerCase())) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  const last = lastNameToken(name);
  if (last && last.length >= 3 && !extract.toLowerCase().includes(last)) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  return { bio: extract.substring(0, 300), photo: data.thumbnail?.source || '' };
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  const byName = new Map(db.map(c => [c.name.toLowerCase(), c]));

  let flagged = 0, added = 0, failed = 0;
  const failedNames = [];
  const addedNames = [];

  for (const name of LEGENDS) {
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (!existing.featured) {
        existing.featured = true;
        flagged++;
      }
      continue;
    }
    const w = await fetchWiki(name);
    if (!w || !w.bio) {
      failed++;
      failedNames.push(name);
      await sleep(100);
      continue;
    }
    db.push({
      name,
      featured: true,
      venues: [],
      bio_wiki: w.bio,
      photo_wiki: w.photo || '',
    });
    added++;
    addedNames.push(name);
    await sleep(100);
  }

  // Write to BOTH paths
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      const localByName = new Map(local.map(c => [c.name.toLowerCase(), c]));
      for (const updated of db) {
        const target = localByName.get(updated.name.toLowerCase());
        if (target) {
          if (updated.featured && !target.featured) target.featured = true;
        } else if (updated.featured && updated.bio_wiki) {
          // New legend entry
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

  console.log(`\n=== Legends seed ===`);
  console.log(`Candidates: ${LEGENDS.length}`);
  console.log(`Already in DB → flagged featured: ${flagged}`);
  console.log(`Newly added with bio+photo: ${added}`);
  console.log(`Failed (no Wiki match): ${failed}`);
  if (addedNames.length) {
    console.log('\n--- Added ---');
    addedNames.forEach(n => console.log('  ' + n));
  }
  if (failedNames.length) {
    console.log('\n--- Failed (need manual check) ---');
    failedNames.forEach(n => console.log('  ' + n));
  }
})().catch(e => { console.error(e); process.exit(1); });

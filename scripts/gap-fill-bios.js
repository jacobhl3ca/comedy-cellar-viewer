#!/usr/bin/env node
/**
 * Wikipedia gap-fill batch.
 *
 * For every comedian in data/comedians.json missing ALL bio fields
 * (bio, bio_stand, bio_wiki, tagline_cellar), fetch the Wikipedia
 * REST summary and — only if the extract passes the comedian
 * disambiguation regex — write the truncated extract into bio_wiki.
 *
 * Also: for the 3 photo-less comedians (mike goldstein, James Mwaura,
 * Joseph Vescey), if Wikipedia returns a thumbnail, save into photo_wiki.
 *
 * NEVER overwrites any existing field.
 *
 * Writes BOTH data/comedians.json AND public/data/comedians.json
 * to keep them in sync (live app reads public/data/).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_PATHS = [
  path.join(ROOT, 'data', 'comedians.json'),
  path.join(ROOT, 'public', 'data', 'comedians.json'),
];
const PHOTOLESS_TARGETS = new Set(['mike goldstein', 'James Mwaura', 'Joseph Vescey']);

// Tighter disambiguation:
//  - extract MUST mention person-noun (comedian/stand-up/stand up/comic) — not just "actor" alone
//  - extract MUST NOT be about a TV series / film / album / book (catches "Get Christie Love is an American crime drama TV series")
//  - last name token MUST appear in the extract (catches J.D. Witherspoon → John Witherspoon mismatch only when last names differ; here both are Witherspoon, so we layer one more guard below)
const COMEDIAN_RE = /\b(comedian|stand-up|stand up|comic\b|comedy festival|sketch comedy|comedy central|saturday night live|snl writer|conan o'brien|tonight show)\b/i;
const NOT_PERSON_RE = /\bis an? (american|british|canadian|australian|irish|new zealand)?\s*(television series|tv series|sitcom|drama|crime drama|film|movie|album|song|video game|book|novel|play|musical|reality (show|series)|podcast series)\b/i;
function lastNameToken(name) {
  // Strip suffixes/initials, take last alphabetical token
  const parts = name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/[^a-z\s]/gi, ' ').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}

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

async function fetchWiki(name, allowVariant = true) {
  const slug = encodeURIComponent(name.replace(/ /g, '_'));
  let data;
  try { data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`); }
  catch { return null; }
  if (!data || data.type === 'disambiguation' || !data.extract) {
    if (allowVariant) {
      await sleep(100);
      return fetchWiki(`${name} (comedian)`, false);
    }
    return null;
  }
  const extract = data.extract;
  const extractLower = extract.toLowerCase();
  // Reject if extract is clearly about a TV series / film / album / book
  if (NOT_PERSON_RE.test(extract)) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  // Require a comedy-specific person-noun (not just "actor" or "television")
  if (!COMEDIAN_RE.test(extractLower)) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  // Require last-name token to appear in extract (catches Jake Silberman → Silbermann mismatch)
  const last = lastNameToken(name);
  if (last && last.length >= 3 && !extractLower.includes(last)) {
    if (allowVariant) { await sleep(100); return fetchWiki(`${name} (comedian)`, false); }
    return null;
  }
  return {
    bio: extract.substring(0, 2000),
    photo: data.thumbnail?.source || ''
  };
}

(async () => {
  // Use the public DB as the source of truth (live, daily-updated).
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));

  // Snapshot for gap_fill_added comparison (used by review CSV downstream).
  const snapshot = new Map();
  for (const c of db) {
    snapshot.set(c.name, {
      bio_wiki: c.bio_wiki || null,
      photo_wiki: c.photo_wiki || null,
    });
  }
  fs.writeFileSync(
    path.join(ROOT, 'data', '.gap-fill-snapshot.json'),
    JSON.stringify([...snapshot.entries()].map(([k, v]) => ({ name: k, ...v })), null, 2)
  );

  let scanned = 0, bioMatched = 0, photoMatched = 0;
  const noMatch = [];
  const bioAdded = []; // {name, bio}
  const photoAdded = []; // {name, photo}

  for (const c of db) {
    const hasBio = c.bio || c.bio_stand || c.bio_wiki || c.tagline_cellar;
    const isPhotoTarget = PHOTOLESS_TARGETS.has(c.name);
    if (hasBio && !isPhotoTarget) continue;
    scanned++;

    const w = await fetchWiki(c.name);
    if (!w) {
      noMatch.push(c.name);
      await sleep(100);
      continue;
    }

    if (!hasBio && w.bio && !c.bio_wiki) {
      c.bio_wiki = w.bio;
      bioMatched++;
      bioAdded.push({ name: c.name, bio: w.bio });
    }
    if (isPhotoTarget && w.photo && !c.photo_wiki) {
      c.photo_wiki = w.photo;
      photoMatched++;
      photoAdded.push({ name: c.name, photo: w.photo });
    }

    await sleep(100);
  }

  // Write back to BOTH DB paths (sync data/ <-> public/data/).
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      // Apply the same updates by name match (don't add new entries here).
      for (const updated of db) {
        const target = local.find(x => x.name === updated.name);
        if (!target) continue;
        if (updated.bio_wiki && !target.bio_wiki) target.bio_wiki = updated.bio_wiki;
        if (updated.photo_wiki && !target.photo_wiki) target.photo_wiki = updated.photo_wiki;
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Wikipedia gap-fill ===`);
  console.log(`Scanned (bio-less or photo-target): ${scanned}`);
  console.log(`New bio_wiki added: ${bioMatched}`);
  console.log(`New photo_wiki added: ${photoMatched}`);
  console.log(`No Wiki match: ${noMatch.length}`);

  console.log(`\n--- Sample new bios (up to 10) ---`);
  for (const x of bioAdded.slice(0, 10)) {
    console.log(`  ${x.name}: ${x.bio.substring(0, 100)}...`);
  }

  console.log(`\n--- All new photos ---`);
  for (const x of photoAdded) {
    console.log(`  ${x.name}: ${x.photo}`);
  }

  console.log(`\n--- Sample names with NO Wiki match (up to 10) ---`);
  for (const n of noMatch.slice(0, 10)) console.log(`  ${n}`);

  console.log(`\nDone. Wrote ${db.length} entries to public/data/comedians.json`);

  // Persist named lists for the CSV step.
  fs.writeFileSync(
    path.join(ROOT, 'data', '.gap-fill-results.json'),
    JSON.stringify({ bioAdded: bioAdded.map(x => x.name), photoAdded: photoAdded.map(x => x.name) }, null, 2)
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});

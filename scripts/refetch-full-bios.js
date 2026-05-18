#!/usr/bin/env node
/**
 * Re-fetch all bio_wiki entries WITHOUT truncation.
 *
 * Earlier scripts truncated extracts to 300 chars. The expanded bio
 * card needs the full extract. This script re-fetches every entry
 * where bio_wiki length >= 280 (likely truncated) from Wikipedia REST
 * and replaces with the full extract (capped at 2000 chars for DB
 * sanity).
 *
 * Disambiguation guards mirror scripts/gap-fill-bios.js exactly:
 *   - reject type === 'disambiguation'
 *   - reject TV-series/film/album/book extracts
 *   - require comedy person-noun
 *   - require last-name token in extract
 * If bare-name fails, try "<name> (comedian)" variant.
 *
 * Writes BOTH data/comedians.json AND public/data/comedians.json.
 * NEVER overwrites with shorter content if re-fetch fails — keeps old bio.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_PATHS = [
  path.join(ROOT, 'data', 'comedians.json'),
  path.join(ROOT, 'public', 'data', 'comedians.json'),
];

const COMEDIAN_RE = /\b(comedian|stand-up|stand up|comic\b|comedy festival|sketch comedy|comedy central|saturday night live|snl writer|conan o'brien|tonight show)\b/i;
const NOT_PERSON_RE = /\bis an? (american|british|canadian|australian|irish|new zealand)?\s*(television series|tv series|sitcom|drama|crime drama|film|movie|album|song|video game|book|novel|play|musical|reality (show|series)|podcast series)\b/i;

function lastNameToken(name) {
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

async function fetchWikiFull(name, allowVariant = true) {
  const slug = encodeURIComponent(name.replace(/ /g, '_'));
  let data;
  try { data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`); }
  catch { return null; }
  if (!data || data.type === 'disambiguation' || !data.extract) {
    if (allowVariant) { await sleep(100); return fetchWikiFull(`${name} (comedian)`, false); }
    return null;
  }
  const extract = data.extract;
  if (NOT_PERSON_RE.test(extract)) {
    if (allowVariant) { await sleep(100); return fetchWikiFull(`${name} (comedian)`, false); }
    return null;
  }
  if (!COMEDIAN_RE.test(extract.toLowerCase())) {
    if (allowVariant) { await sleep(100); return fetchWikiFull(`${name} (comedian)`, false); }
    return null;
  }
  const last = lastNameToken(name);
  if (last && last.length >= 3 && !extract.toLowerCase().includes(last)) {
    if (allowVariant) { await sleep(100); return fetchWikiFull(`${name} (comedian)`, false); }
    return null;
  }
  // Cap at 2000 chars; no 300-char truncation.
  return { bio: extract.substring(0, 2000) };
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));

  let scanned = 0, replaced = 0, failed = 0;
  const replacedSamples = [];
  const failedNames = [];

  for (const c of db) {
    if (!c.bio_wiki || c.bio_wiki.length < 280) continue;
    scanned++;
    const oldLen = c.bio_wiki.length;
    const w = await fetchWikiFull(c.name);
    if (w && w.bio && w.bio.length > 0) {
      c.bio_wiki = w.bio;
      replaced++;
      if (replacedSamples.length < 10) {
        replacedSamples.push({ name: c.name, oldLen, newLen: w.bio.length });
      }
    } else {
      failed++;
      failedNames.push(c.name);
    }
    await sleep(100);
  }

  // Write back to both DB paths — only update bio_wiki, preserve everything else.
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const updated of db) {
        const target = local.find(x => x.name === updated.name);
        if (!target) continue;
        if (updated.bio_wiki) target.bio_wiki = updated.bio_wiki;
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Re-fetch full bios ===`);
  console.log(`Scanned (bio_wiki length >= 280): ${scanned}`);
  console.log(`Replaced with full extract: ${replaced}`);
  console.log(`Re-fetch failed (kept old bio): ${failed}`);

  console.log(`\n--- Sample replaced (up to 10) ---`);
  for (const r of replacedSamples) {
    console.log(`  ${r.name}: was ${r.oldLen} chars -> now ${r.newLen} chars`);
  }

  if (failedNames.length) {
    console.log(`\n--- Failed names (kept 300-char bio) ---`);
    failedNames.forEach(n => console.log('  ' + n));
  }
})().catch(e => { console.error(e); process.exit(1); });

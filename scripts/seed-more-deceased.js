#!/usr/bin/env node
/**
 * Seed additional deceased stand-ups into In Memoriam.
 *
 * For each name below, fetch Wikipedia REST summary (bare name first;
 * fall back to "<name> (comedian)" only for the thumbnail if missing).
 * These are all famous unambiguous comedians, so the disambiguation
 * guards are relaxed — just take the extract.
 *
 * Adds: { name, deceased: true, venues: [], bio_wiki (<=2000), photo_wiki }
 * Skips any name already in the DB.
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

const NAMES = [
  'Don Rickles',
  'George Carlin',
  'Rodney Dangerfield',
  'Joan Rivers',
  'Phil Hartman',
  'Bernie Mac',
  'Sam Kinison',
  'Jerry Stiller',
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

async function fetchSummary(name) {
  const slug = encodeURIComponent(name.replace(/ /g, '_'));
  try { return await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`); }
  catch { return null; }
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  const byName = new Map(db.map(c => [c.name.toLowerCase(), c]));

  const added = [];
  const failed = [];

  for (const name of NAMES) {
    if (byName.has(name.toLowerCase())) {
      console.log(`Skipping (already in DB): ${name}`);
      continue;
    }

    const bare = await fetchSummary(name);
    await sleep(100);
    let bio = '';
    let photo = '';

    if (bare && bare.extract && bare.type !== 'disambiguation') {
      bio = bare.extract.substring(0, 2000);
      photo = bare.thumbnail?.source || '';
    }

    // If thumbnail missing on bare name, try (comedian) variant for photo only.
    if (!photo) {
      const variant = await fetchSummary(`${name} (comedian)`);
      await sleep(100);
      if (variant && variant.thumbnail?.source) photo = variant.thumbnail.source;
      // Also accept variant extract if bare had none
      if (!bio && variant && variant.extract && variant.type !== 'disambiguation') {
        bio = variant.extract.substring(0, 2000);
      }
    }

    if (!bio && !photo) {
      console.log(`FAILED (no bio + no photo): ${name}`);
      failed.push(name);
      continue;
    }

    const entry = {
      name,
      deceased: true,
      venues: [],
      bio_wiki: bio,
      photo_wiki: photo,
    };
    db.push(entry);
    byName.set(name.toLowerCase(), entry);
    added.push({ name, bioLen: bio.length, hasPhoto: !!photo });
    console.log(`Added: ${name} (bio=${bio.length} chars, photo=${photo ? 'yes' : 'NO'})`);
  }

  // Write to both DB paths
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      const localByName = new Map(local.map(c => [c.name.toLowerCase(), c]));
      for (const entry of added) {
        if (!localByName.has(entry.name.toLowerCase())) {
          const fromDb = db.find(c => c.name === entry.name);
          if (fromDb) local.push(fromDb);
        }
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Deceased seed ===`);
  console.log(`Candidates: ${NAMES.length}`);
  console.log(`Added: ${added.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length) console.log(`Failed names: ${failed.join(', ')}`);
})().catch(e => { console.error(e); process.exit(1); });

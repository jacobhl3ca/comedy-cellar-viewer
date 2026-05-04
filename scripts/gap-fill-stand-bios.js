#!/usr/bin/env node
/**
 * One-shot Stand-profile bio gap-fill.
 *
 * For every comedian in data/comedians.json with venues.includes('the_stand')
 * and no bio of any kind (bio, bio_stand, bio_wiki, tagline_cellar), fetch the
 * Stand profile page and extract the bare-text bio block.
 *
 * Same regex + filter as fetchStandBio in scripts/prebake.js, just run once
 * across the full DB instead of only this week's scrape.
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

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CellarTonight/1.0 (tonightnyc.com)' } }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function nameToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function isGenericBio(bio) {
  if (!bio || bio.length < 10) return true;
  const lower = bio.toLowerCase();
  if (/^[\w\s.'-]+ is a (stand-up )?comedian/.test(lower) && bio.length < 80) return true;
  if (/^[\w\s.'-]+ is a regular at/.test(lower)) return true;
  if (/performs regularly|regular at|clubs across the city|comedy circuit|nyc comedy scene|performing on the/.test(lower) && bio.length < 200) return true;
  if (/netflix|hbo|comedy central|snl|saturday night|tonight show|late night|conan|fallon|kimmel|colbert|letterman|daily show|imdb/i.test(bio)) return false;
  if (/^[\w\s.'-]+ is a comedian/.test(lower) && bio.length < 120) return true;
  return false;
}

async function fetchStandBio(slugOrName) {
  try {
    const slug = slugOrName.includes('/') ? slugOrName.split('/').pop() : nameToSlug(slugOrName);
    const html = await fetchText(`https://thestandnyc.com/comedians/${slug}`);
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

(async () => {
  const db = JSON.parse(fs.readFileSync(DB_PATHS[0], 'utf8'));
  const targets = db.filter(c =>
    !c.deceased &&
    (c.venues?.includes('the_stand') || c.stand_profile) &&
    !c.bio && !c.bio_stand && !c.bio_wiki && !c.tagline_cellar
  );

  console.log(`Targeting ${targets.length} Stand comedians missing bios.`);
  let filled = 0;
  let skipped = 0;
  let i = 0;
  for (const c of targets) {
    i++;
    // Prefer the explicit stand_profile URL when it differs from the slug derived from the name
    const slug = c.stand_profile ? c.stand_profile.split('/').pop() : nameToSlug(c.name);
    const bio = await fetchStandBio(slug);
    if (bio && !isGenericBio(bio)) {
      c.bio_stand = bio;
      filled++;
      if (filled % 10 === 0) console.log(`  [${i}/${targets.length}] +${filled} filled (${c.name})`);
    } else {
      skipped++;
    }
    await sleep(150); // be polite
  }

  console.log(`\nDone. Filled: ${filled}, no usable bio on profile: ${skipped}`);

  for (const p of DB_PATHS) {
    fs.writeFileSync(p, JSON.stringify(db, null, 2));
    console.log(`Wrote ${p}`);
  }
})();

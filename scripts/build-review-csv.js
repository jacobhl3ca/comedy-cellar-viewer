#!/usr/bin/env node
/**
 * Build data/comedian-review.csv from public/data/comedians.json.
 * Columns: name, venues, deceased, photo_url, bio, bio_source, gap_fill_added.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'public', 'data', 'comedians.json');
const SNAP = path.join(ROOT, 'data', '.gap-fill-snapshot.json');
const RESULTS = path.join(ROOT, 'data', '.gap-fill-results.json');
const CSV_OUT = path.join(ROOT, 'data', 'comedian-review.csv');
const PHOTO_DIR = path.join(ROOT, 'public', 'photos');

function nameToFilename(name) {
  return name.toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function isGenericBio(bio) {
  if (!bio) return true;
  const lower = bio.toLowerCase();
  if (/performs regularly|regular at the|clubs across the city|comedy circuit|nyc comedy scene|performing on the/.test(lower) && bio.length < 200) return true;
  const startsGeneric = /^[a-z\s.'-]+ is a (stand-up )?comedian/.test(lower);
  if (startsGeneric) {
    if (/appeared on|starred in|featured on|netflix|hbo|comedy central|conan|tonight show|letterman|fallon|colbert|snl|saturday night live|published|author|podcast|youtube|special|award|emmy|grammy/.test(lower)) return false;
    if (/performs (regularly )?on the/.test(lower) || /performing (in|on)/.test(lower) ||
        /performs at clubs/.test(lower) || /regular at/.test(lower) ||
        /known for (his|her|their) (unique|sharp|fresh|energetic)/.test(lower) ||
        /across the city/.test(lower) || /comedy scene/.test(lower)) return true;
    if (bio.length < 120) return true;
  }
  return false;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const blobs = new Set(fs.existsSync(PHOTO_DIR) ? fs.readdirSync(PHOTO_DIR) : []);

let snapshot = new Map();
try {
  const arr = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  for (const r of arr) snapshot.set(r.name, r);
} catch {}

let gapFillNames = new Set();
try {
  const r = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  for (const n of (r.bioAdded || [])) gapFillNames.add(n);
  for (const n of (r.photoAdded || [])) gapFillNames.add(n);
} catch {}

const rows = [];
rows.push(['name', 'venues', 'deceased', 'photo_url', 'bio', 'bio_source', 'gap_fill_added'].map(csvEscape).join(','));

for (const c of db) {
  const venues = (c.venues || []).join(',');
  const deceased = c.deceased ? 'true' : '';

  // Photo URL: same priority as getPhotoForVenue('') would resolve.
  let photoUrl = '';
  if (c.photo_nycc) photoUrl = c.photo_nycc;
  else if (c.photo_stand) photoUrl = c.photo_stand;
  else if (c.photo_cellar) photoUrl = c.photo_cellar;
  else if (c.photo_wiki) photoUrl = c.photo_wiki;
  else {
    const fn = nameToFilename(c.name);
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      if (blobs.has(`${fn}.${ext}`)) { photoUrl = `/photos/${fn}.${ext}`; break; }
    }
  }

  // Bio: first non-generic of bio | bio_stand | bio_wiki | tagline_cellar.
  let bio = '', bioSource = 'none';
  const candidates = [
    ['nycc', c.bio],
    ['stand', c.bio_stand],
    ['wiki', c.bio_wiki],
    ['cellar_tagline', c.tagline_cellar],
  ];
  for (const [src, val] of candidates) {
    if (val && !isGenericBio(val)) { bio = val; bioSource = src; break; }
  }
  // Fall back to any value even if generic, for review visibility.
  if (!bio) {
    for (const [src, val] of candidates) {
      if (val) { bio = val; bioSource = src; break; }
    }
  }
  if (bio.length > 200) bio = bio.substring(0, 200);

  // Gap-fill added flag: snapshot had no bio_wiki/photo_wiki, now has one.
  let gapFillAdded = 'no';
  if (gapFillNames.has(c.name)) {
    gapFillAdded = 'yes';
  } else {
    const before = snapshot.get(c.name);
    if (before) {
      if ((!before.bio_wiki && c.bio_wiki) || (!before.photo_wiki && c.photo_wiki)) gapFillAdded = 'yes';
    }
  }

  rows.push([c.name, venues, deceased, photoUrl, bio, bioSource, gapFillAdded].map(csvEscape).join(','));
}

fs.writeFileSync(CSV_OUT, rows.join('\n') + '\n');
console.log(`Wrote ${rows.length - 1} rows to ${CSV_OUT}`);

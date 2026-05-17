#!/usr/bin/env node
/**
 * One-shot dedupe pass.
 *
 * Merges 7 near-duplicate pairs in comedians.json (case + apostrophe variants):
 *   Roy Wood Jr            <-> Roy Wood Jr.
 *   Eric D'Alessandro      <-> Eric D'Alessandro  (curly vs straight apostrophe)
 *   Maria DeCotis          <-> Maria Decotis
 *   Matteo Lane            <-> Matteo lane
 *   Onika McLean           <-> Onika Mclean
 *   Tom McGuire            <-> Tom Mcguire
 *   Anthony Devito         <-> Anthony DeVito
 *
 * For each pair: pick canonical (richer entry / proper case), merge fields
 * additively (never overwrite), delete the dupe, add NAME_FIXES alias
 * so future show data with the dupe spelling maps to canonical.
 *
 * Also: drop Crystal Marie Denha's "BlankBackground" placeholder photo_nycc.
 *
 * Writes BOTH data/comedians.json AND public/data/comedians.json.
 * Updates NAME_FIXES in BOTH src/data.js AND scripts/prebake.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB_PATHS = [
  path.join(ROOT, 'data', 'comedians.json'),
  path.join(ROOT, 'public', 'data', 'comedians.json'),
];

// [canonical, dupe]
const PAIRS = [
  ['Roy Wood Jr.', 'Roy Wood Jr'],
  ['Eric D’Alessandro', 'Eric D\'Alessandro'],
  ['Maria DeCotis', 'Maria Decotis'],
  ['Matteo Lane', 'Matteo lane'],
  ['Onika McLean', 'Onika Mclean'],
  ['Tom McGuire', 'Tom Mcguire'],
  ['Anthony DeVito', 'Anthony Devito'],
];

function mergeInto(canonical, dupe) {
  // Combine venues (unique)
  const venues = new Set([...(canonical.venues || []), ...(dupe.venues || [])]);
  canonical.venues = [...venues];
  // Copy missing fields only — NEVER overwrite
  const fields = [
    'nycc_profile', 'photo_nycc',
    'stand_profile', 'photo_stand',
    'photo_cellar', 'photo_wiki',
    'bio', 'bio_stand', 'bio_wiki', 'tagline_cellar',
  ];
  for (const f of fields) {
    if (!canonical[f] && dupe[f]) canonical[f] = dupe[f];
  }
  if (dupe.deceased && !canonical.deceased) canonical.deceased = true;
  if (dupe.featured && !canonical.featured) canonical.featured = true;
}

function dedupe(db) {
  let merged = 0;
  for (const [canon, dup] of PAIRS) {
    const c = db.find(x => x.name === canon);
    const d = db.find(x => x.name === dup);
    if (!c && d) {
      // No canonical exists, rename the dupe
      d.name = canon;
      console.log(`Renamed ${dup} -> ${canon}`);
      continue;
    }
    if (c && d) {
      mergeInto(c, d);
      const idx = db.indexOf(d);
      db.splice(idx, 1);
      merged++;
      console.log(`Merged ${dup} into ${canon}`);
    }
  }
  // Crystal Marie BlankBackground placeholder cleanup
  const cm = db.find(x => x.name === 'Crystal Marie Denha');
  if (cm && cm.photo_nycc && /BlankBackground/i.test(cm.photo_nycc)) {
    delete cm.photo_nycc;
    console.log('Dropped BlankBackground photo_nycc from Crystal Marie Denha');
  }
  return merged;
}

function updateNameFixes(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  const newAliases = PAIRS
    .map(([canon, dup]) => `  '${dup.replace(/'/g, "\\'")}': '${canon.replace(/'/g, "\\'")}',`)
    .join('\n');

  // Insert before closing brace of NAME_FIXES — find the const NAME_FIXES = { ... } block.
  const m = src.match(/const NAME_FIXES = \{[\s\S]*?\};/);
  if (!m) {
    console.warn(`No NAME_FIXES block in ${filePath}`);
    return;
  }
  const block = m[0];
  // Skip aliases that already exist
  const aliasesToAdd = PAIRS
    .filter(([canon, dup]) => !block.includes(`'${dup}'`))
    .map(([canon, dup]) => `  '${dup.replace(/'/g, "\\'")}': '${canon.replace(/'/g, "\\'")}',`);
  if (aliasesToAdd.length === 0) {
    console.log(`No new aliases for ${path.basename(filePath)}`);
    return;
  }
  const insertion = aliasesToAdd.join('\n');
  const newBlock = block.replace(/(\n)(\};)$/, `\n${insertion}\n$2`);
  src = src.replace(block, newBlock);
  fs.writeFileSync(filePath, src);
  console.log(`Added ${aliasesToAdd.length} aliases to ${path.basename(filePath)}`);
}

(async () => {
  for (const p of DB_PATHS) {
    const db = JSON.parse(fs.readFileSync(p, 'utf8'));
    const before = db.length;
    const merged = dedupe(db);
    fs.writeFileSync(p, JSON.stringify(db, null, 2) + '\n');
    console.log(`${path.relative(ROOT, p)}: ${before} -> ${db.length} entries (merged ${merged})`);
  }
  updateNameFixes(path.join(ROOT, 'src', 'data.js'));
  updateNameFixes(path.join(ROOT, 'scripts', 'prebake.js'));
  console.log('\nDedupe done.');
})().catch(e => { console.error(e); process.exit(1); });

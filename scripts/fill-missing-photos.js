#!/usr/bin/env node
/**
 * Fill photos for visible comedians who have no photo from any source.
 * Tries: Wikipedia (with comedian disambig guard) → Stand profile → NYCC profile.
 * Rejects placeholder URLs (twitter-card, site-default, BlankBackground).
 *
 * Writes photo_wiki | photo_stand | photo_nycc field on each entry.
 * NEVER overwrites existing values.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_PATHS = [
  path.join(ROOT, 'data', 'comedians.json'),
  path.join(ROOT, 'public', 'data', 'comedians.json'),
];
const PHOTO_DIR = path.join(ROOT, 'public', 'photos');

const blobs = new Set(fs.readdirSync(PHOTO_DIR).map(f => f.replace(/\.[^.]+$/, '')));
function slug(n) {
  return n.toLowerCase().replace(/['‘’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
function urlSlug(n) {
  return n.toLowerCase().replace(/['‘’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '');
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CellarTonight/1.0 (cellartonight.com)' } }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
      if (resp.statusCode === 301 || resp.statusCode === 302) return fetchText(resp.headers.location).then(resolve).catch(reject);
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PLACEHOLDER_RE = /BlankBackground|twitter-card|\/images\/site\/|placeholder|default-headshot|nopic|nycc_trans|nycc_logo/i;
const COMEDIAN_RE = /\b(comedian|stand-up|stand up|comic\b|comedy|actress|actor|television|tv host|sketch|improv|snl|saturday night live)\b/i;
const NOT_PERSON_RE = /\bis an? (american|british|canadian|australian|indian|pakistani|irish)?\s*(tv series|television series|film|movie|album|sitcom|crime drama)\b/i;

async function tryWiki(name, allowVariant = true) {
  try {
    const slug = encodeURIComponent(name.replace(/ /g, '_'));
    const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
    if (!data || data.type === 'disambiguation' || !data.extract) {
      if (allowVariant) { await sleep(100); return tryWiki(`${name} (comedian)`, false); }
      return null;
    }
    if (NOT_PERSON_RE.test(data.extract) || /\bmay refer to\b/i.test(data.extract)) {
      if (allowVariant) { await sleep(100); return tryWiki(`${name} (comedian)`, false); }
      return null;
    }
    if (!COMEDIAN_RE.test(data.extract.toLowerCase())) {
      if (allowVariant) { await sleep(100); return tryWiki(`${name} (comedian)`, false); }
      return null;
    }
    const lastName = name.split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
    if (lastName.length >= 3 && !data.extract.toLowerCase().includes(lastName)) return null;
    return { photo: data.thumbnail?.source || '', bio: data.extract };
  } catch { return null; }
}

async function tryStand(slug) {
  try {
    const html = await fetchText(`https://thestandnyc.com/comedians/${slug}`);
    let m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (m) {
      let u = m[1];
      if (PLACEHOLDER_RE.test(u)) return null;
      return u;
    }
    m = html.match(/src="(\/images\/comedians\/_square\/[^"]+)"/);
    if (m) return 'https://thestandnyc.com' + m[1];
    return null;
  } catch { return null; }
}

async function tryNycc(slug) {
  try {
    const html = await fetchText(`https://newyorkcomedyclub.com/comedians/${slug}`);
    // Only accept URLs that point to the comedian-photo directory.
    // og:image is unreliable — falls back to site logo when comedian has no photo.
    const m = html.match(/src="([^"]*\/img\/comedians\/[^"]+)"/);
    if (m) {
      const u = m[1].startsWith('http') ? m[1] : 'https://newyorkcomedyclub.com' + m[1];
      if (PLACEHOLDER_RE.test(u) || /BlankBackground/i.test(u)) return null;
      return u;
    }
    return null;
  } catch { return null; }
}

(async () => {
  const primary = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primary, 'utf8'));
  const targets = db.filter(c =>
    !c.deceased && !c.not_a_person
    && !c.photo_nycc && !c.photo_stand && !c.photo_cellar && !c.photo_wiki
    && !blobs.has(slug(c.name))
  );
  console.log(`${targets.length} comedians to try.\n`);

  let wikiPhotos = 0, wikiBios = 0, standPhotos = 0, nyccPhotos = 0, failed = 0;
  const log = [];

  for (const c of targets) {
    const s = urlSlug(c.name);
    // 1. Wikipedia (gives photo + bio if found)
    let got = null;
    const w = await tryWiki(c.name);
    if (w && w.photo) {
      c.photo_wiki = w.photo;
      wikiPhotos++;
      got = 'wiki-photo';
    }
    if (w && w.bio && !c.bio_wiki && !c.bio && !c.bio_stand) {
      c.bio_wiki = w.bio.substring(0, 2000);
      wikiBios++;
      got = (got || '') + '+bio';
    }
    // 2. Stand profile photo (only if Wikipedia didn't have one)
    if (!c.photo_wiki) {
      await sleep(80);
      const sp = await tryStand(s);
      if (sp) { c.photo_stand = sp; standPhotos++; got = 'stand'; }
    }
    // 3. NYCC profile photo
    if (!c.photo_wiki && !c.photo_stand) {
      await sleep(80);
      const np = await tryNycc(s);
      if (np) { c.photo_nycc = np; nyccPhotos++; got = 'nycc'; }
    }
    if (!got) { failed++; log.push(`  ${c.name}: no photo found`); }
    else log.push(`  ${c.name}: ${got}`);
    await sleep(80);
  }

  // Mirror to both DBs
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      const idx = new Map(local.map(c => [c.name, c]));
      for (const u of db) {
        const t = idx.get(u.name);
        if (!t) continue;
        if (u.photo_wiki && !t.photo_wiki) t.photo_wiki = u.photo_wiki;
        if (u.photo_stand && !t.photo_stand) t.photo_stand = u.photo_stand;
        if (u.photo_nycc && !t.photo_nycc) t.photo_nycc = u.photo_nycc;
        if (u.bio_wiki && !t.bio_wiki && !t.bio && !t.bio_stand) t.bio_wiki = u.bio_wiki;
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) { console.warn(`Could not write ${p}: ${e.message}`); }
  }

  console.log(`\n=== Photo fill ===`);
  console.log(`Wiki: ${wikiPhotos} photos + ${wikiBios} bios`);
  console.log(`Stand: ${standPhotos} photos`);
  console.log(`NYCC: ${nyccPhotos} photos`);
  console.log(`Still missing: ${failed}`);
  console.log(`\n--- Per-name ---`);
  log.slice(0, 100).forEach(l => console.log(l));
})().catch(e => { console.error(e); process.exit(1); });

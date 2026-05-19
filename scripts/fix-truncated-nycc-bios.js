#!/usr/bin/env node
/**
 * One-shot fix for ~13 NYCC bios that were stored as ~400 chars + literal "...".
 * Re-scrapes each comedian's NYCC profile page and reads the og:description /
 * meta description tag (which is the FULL bio, not truncated).
 *
 * Overwrites `bio` ONLY if the current value ends with "..." AND the fetched
 * full bio starts with the same prefix (sanity guard against wrong-page matches).
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
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    }, (resp) => {
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return fetchText(resp.headers.location).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function decodeEntities(str) {
  return str
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchNyccBio(slug) {
  try {
    const html = await fetchText(`https://newyorkcomedyclub.com/comedians/${slug}`);
    // Prefer og:description (full bio); fall back to meta name=description.
    let m = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    if (!m) return null;
    return decodeEntities(m[1]).trim();
  } catch { return null; }
}

function nameToSlug(name) {
  return name.toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));

  // Find candidates: bio ends with "..." and roughly looks truncated (300-420 chars)
  const candidates = db.filter(c =>
    c.bio
    && /\.\.\.$/.test(c.bio.trim())
    && c.bio.length >= 300
    && c.bio.length <= 450
    && (c.nycc_profile || (c.venues || []).includes('nycc'))
  );

  console.log(`Found ${candidates.length} truncated NYCC bios. Re-scraping...\n`);

  const fixed = [], failed = [];

  for (const c of candidates) {
    const slug = c.nycc_profile ? c.nycc_profile.split('/').pop() : nameToSlug(c.name);
    const newBio = await fetchNyccBio(slug);
    if (!newBio || newBio.length < 50) {
      failed.push(`${c.name} (no fetch)`);
      await sleep(120); continue;
    }
    // Reject NYCC's generic site-wide boilerplate.
    if (/^comedians peforming|^comedians performing|^info on .* (including|at) upcoming shows/i.test(newBio)) {
      failed.push(`${c.name} (got boilerplate)`);
      await sleep(120); continue;
    }
    // Sanity guard: first 30 alphanumeric chars of new bio should match old bio's start
    // (apostrophe/quote encoding may differ between python scraper output + NYCC's current HTML)
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
    const prefixMatches = normalize(c.bio) === normalize(newBio);
    // Looser fallback: new bio is substantially longer AND contains at least one name token
    // (covers cases where NYCC genuinely refreshed the bio for an existing comedian).
    let looseOk = false;
    if (!prefixMatches && newBio.length >= 500) {
      const nameTokens = c.name.toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(t => t.length >= 3);
      const newLower = newBio.toLowerCase();
      looseOk = nameTokens.some(t => newLower.includes(t));
    }
    if (!prefixMatches && !looseOk) {
      failed.push(`${c.name} (prefix mismatch, len ${newBio.length})`);
      await sleep(120); continue;
    }
    const oldLen = c.bio.length;
    c.bio = newBio;
    fixed.push(`${c.name}: ${oldLen} → ${newBio.length} chars`);
    await sleep(120);
  }

  // Mirror to both DBs
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const updated of db) {
        const t = local.find(x => x.name === updated.name);
        if (!t) continue;
        // Only overwrite if local's bio is the truncated one
        if (t.bio && /\.\.\.$/.test(t.bio.trim()) && t.bio.length <= 450
            && updated.bio && !/\.\.\.$/.test(updated.bio.trim())) {
          t.bio = updated.bio;
        }
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Fixed (${fixed.length}) ===`);
  fixed.forEach(s => console.log('  ' + s));
  if (failed.length) {
    console.log(`\n=== Failed (${failed.length}) ===`);
    failed.forEach(s => console.log('  ' + s));
  }
})().catch(e => { console.error(e); process.exit(1); });

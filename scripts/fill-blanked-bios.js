#!/usr/bin/env node
/**
 * Fill bios for 5 names that had wrong-person Wikipedia matches blanked.
 *
 * Strategy per name:
 *  1. Try Stand: https://thestandnyc.com/comedians/<slug> → og:description or visible bio.
 *  2. Else try NYCC: https://newyorkcomedyclub.com/comedians/<slug>.
 *  3. Generic-sounding bios still accepted.
 *
 * Result written into:
 *   - bio_stand  if from Stand
 *   - bio_wiki   if from NYCC (we don't own the NYCC bio field;
 *                "bio" field is NYCC-canonical and parent forbade it)
 *
 * NEVER overwrites existing non-empty fields.
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
  'Julio Diaz',
  'Dan Davies',
  'Sarah Thomas',
  'Jay Lawrence',
  'Dan Fox',
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function fetchText(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 CellarTonight/1.0',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 15000
    }, (resp) => {
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return resolve(fetchText(resp.headers.location));
      }
      if (resp.statusCode !== 200) return resolve({ ok: false, status: resp.statusCode, body: '' });
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => resolve({ ok: true, status: 200, body }));
    }).on('error', () => resolve({ ok: false, status: 0, body: '' }));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function decodeHtmlEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

function extractBio(html, name) {
  // 1) NYCC: <div class="comedian-view-description">...</div>
  const nyccDiv = html.match(/<div\s+class=["']comedian-view-description["'][^>]*>([\s\S]*?)<\/div>/i);
  if (nyccDiv) {
    const inner = nyccDiv[1].replace(/<div class=["']fadeout["'][^>]*><\/div>/i, '');
    const v = decodeHtmlEntities(stripTags(inner)).trim();
    if (v && v.length > 20) return v;
  }
  // 2) og:description (allow multi-line / attr-order variations)
  const og = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/is)
         || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/is);
  if (og && og[1]) {
    const v = decodeHtmlEntities(og[1]).trim();
    if (v && v.length > 20) return v;
  }
  // 3) <meta name="description">
  const md = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/is)
         || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/is);
  if (md && md[1]) {
    const v = decodeHtmlEntities(md[1]).trim();
    if (v && v.length > 20) return v;
  }
  // 4) Stand: <div class="bio"> ...
  const bioDiv = html.match(/<div[^>]*class=["'][^"']*\bbio\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (bioDiv) {
    const v = decodeHtmlEntities(stripTags(bioDiv[1])).trim();
    if (v && v.length > 20) return v;
  }
  // 5) First <p> following the name heading
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = new RegExp(`<(h1|h2|h3)[^>]*>\\s*${escName}[^<]*<\\/\\1>([\\s\\S]{0,4000}?)<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i');
  const m = html.match(nameRe);
  if (m) {
    const v = decodeHtmlEntities(stripTags(m[3])).trim();
    if (v && v.length > 20) return v;
  }
  return '';
}

async function tryStand(name) {
  const url = `https://thestandnyc.com/comedians/${slugify(name)}`;
  const r = await fetchText(url);
  if (!r.ok) return { source: 'stand', url, bio: '', status: r.status };
  const bio = extractBio(r.body, name);
  return { source: 'stand', url, bio, status: r.status };
}

async function tryNYCC(name) {
  const url = `https://newyorkcomedyclub.com/comedians/${slugify(name)}`;
  const r = await fetchText(url);
  if (!r.ok) return { source: 'nycc', url, bio: '', status: r.status };
  const bio = extractBio(r.body, name);
  return { source: 'nycc', url, bio, status: r.status };
}

(async () => {
  const primaryPath = DB_PATHS[1];
  const db = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));

  const results = [];
  const updates = []; // {name, field, value}

  for (const name of NAMES) {
    const entry = db.find(c => c.name === name);
    if (!entry) {
      console.log(`NOT IN DB: ${name}`);
      results.push({ name, found: false, source: null });
      continue;
    }

    // 1) Try Stand
    const s = await tryStand(name);
    await sleep(400);
    if (s.bio) {
      if (!entry.bio_stand) {
        entry.bio_stand = s.bio.substring(0, 2000);
        updates.push({ name, field: 'bio_stand', len: entry.bio_stand.length, source: 'stand' });
        console.log(`STAND OK: ${name} (${entry.bio_stand.length} chars) [${s.url}]`);
        results.push({ name, found: true, source: 'stand', len: entry.bio_stand.length });
        continue;
      }
    }

    // 2) Try NYCC
    const n = await tryNYCC(name);
    await sleep(400);
    if (n.bio) {
      if (!entry.bio_wiki) {
        entry.bio_wiki = n.bio.substring(0, 2000);
        updates.push({ name, field: 'bio_wiki', len: entry.bio_wiki.length, source: 'nycc' });
        console.log(`NYCC OK : ${name} (${entry.bio_wiki.length} chars) [${n.url}]`);
        results.push({ name, found: true, source: 'nycc', len: entry.bio_wiki.length });
        continue;
      }
    }

    console.log(`NOTHING : ${name} (stand=${s.status} nycc=${n.status})`);
    results.push({ name, found: false, source: null, stand_status: s.status, nycc_status: n.status });
  }

  // Write back to both DB paths
  for (const p of DB_PATHS) {
    try {
      const local = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const u of updates) {
        const target = local.find(x => x.name === u.name);
        if (!target) continue;
        // Don't overwrite existing non-empty values
        if (u.field === 'bio_stand' && !target.bio_stand) {
          target.bio_stand = db.find(c => c.name === u.name).bio_stand;
        }
        if (u.field === 'bio_wiki' && !target.bio_wiki) {
          target.bio_wiki = db.find(c => c.name === u.name).bio_wiki;
        }
      }
      fs.writeFileSync(p, JSON.stringify(local, null, 2) + '\n');
    } catch (e) {
      console.warn(`Could not write ${p}: ${e.message}`);
    }
  }

  console.log(`\n=== Fill blanked bios ===`);
  console.log(`Names: ${NAMES.length}, Updates: ${updates.length}`);
  for (const r of results) {
    if (r.found) console.log(`  ${r.name}: ${r.source} (${r.len} chars)`);
    else console.log(`  ${r.name}: NONE FOUND`);
  }
})().catch(e => { console.error(e); process.exit(1); });

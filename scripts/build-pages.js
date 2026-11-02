// Write one static HTML page per venue view (public/cellar.html, ...) and
// public/sitemap.xml, both from VIEW_META in src/init.js.
//
// Why: every venue path used to be a vercel.json rewrite to the one
// index.html, whose raw head says canonical = https://tonightnyc.com. Google
// reads the raw head, so it filed /cellar, /stand, ... as copies of the home
// page and never indexed them. syncUrlToSource() fixes title + canonical only
// in JS. Each venue page is index.html with its own title, description,
// canonical and og tags, so the raw head is already right.
//
// Each page also ships its venue H1 and the next 10 shows in the raw HTML, read
// from the prebaked public/data/*-cache.json. The nightly prebake commit triggers
// a Vercel deploy, and that deploy's build runs this script, so the list refreshes
// with the caches. The app renders the real list, so an inline script removes the
// static one before first paint: only a reader with no JS sees it.
//
// Runs after cachebust.js (it copies the stamped index.html). Idempotent.
// OUT_DIR overrides where the pages + sitemap go (tests use a temp dir).
// CACHE_DIR and BUILD_DATE (YYYY-MM-DD) override the show data and "today" in tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://tonightnyc.com';
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'public');
const CACHE_DIR = process.env.CACHE_DIR || path.join(ROOT, 'public/data');
const MAX_SHOWS = 10;

function fail(msg) {
  console.error(`build-pages: ${msg}`);
  process.exit(1);
}

function loadViewMeta() {
  const src = fs.readFileSync(path.join(ROOT, 'src/init.js'), 'utf8');
  const m = src.match(/const VIEW_META = (\{[\s\S]*?\n\});/);
  if (!m) fail('no `const VIEW_META = { ... };` block in src/init.js');
  const meta = vm.runInNewContext(`(${m[1]})`);
  for (const [key, e] of Object.entries(meta)) {
    for (const field of ['path', 'h1', 'title', 'description']) {
      if (typeof e[field] !== 'string' || !e[field]) fail(`VIEW_META['${key}'] has no ${field}`);
    }
  }
  if (!meta.all || meta.all.path !== '/') fail("VIEW_META['all'] must have path '/'");
  return meta;
}

const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- The static show list ---------------------------------------------------
const CLUB_CACHES = {
  'the-stand': 'stand-cache.json',
  gotham: 'gotham-cache.json',
  nycc: 'nycc-cache.json',
  standupny: 'standupny-cache.json',
  'union-hall': 'unionhall-cache.json',
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
});

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
  } catch (e) {
    // A missing cache costs one page its list, never the deploy.
    console.warn(`build-pages: no show list from ${file}: ${e.message}`);
    return null;
  }
}

const clubShows = (file) => {
  const shows = readCache(file)?.shows;
  return Array.isArray(shows) ? shows : [];
};

// The Cellar cache holds its site's HTML per day, one .set-header per show.
function cellarShows() {
  const results = readCache('cellar-cache.json')?.results || {};
  const shows = [];
  for (const [date, day] of Object.entries(results)) {
    const sets = String(day?.show?.html || '').split('<div class="set-header">').slice(1);
    for (const set of sets) {
      const time = (set.match(/<span class="bold">([^<]+)/) || [])[1];
      const title = (set.match(/<span class="title">([^<]*)<\/span>/) || [])[1];
      if (!time || !title) continue;
      const booking = (set.match(/href="(\/reservations-newyork\/[^"]*)"/) || [])[1];
      shows.push({
        title: decodeEntities(title),
        date,
        time,
        venue: 'Comedy Cellar',
        comedians: [...set.matchAll(/<span class="name">([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1])),
        url: booking ? `https://www.comedycellar.com${decodeEntities(booking)}` : '',
      });
    }
  }
  return shows;
}

function allClubShows() {
  return [...cellarShows(), ...Object.values(CLUB_CACHES).flatMap(clubShows)];
}

function showsForView(key) {
  if (key === 'cellar') return cellarShows();
  if (key === 'big-shows') {
    const events = readCache('big-shows-cache.json')?.events;
    return Array.isArray(events) ? events : [];
  }
  if (CLUB_CACHES[key]) return clubShows(CLUB_CACHES[key]);
  return allClubShows(); // /tonight and /comics span every club
}

// "8:00 PM", "7:00 pm", "19:00" -> minutes after midnight, or null.
function timeMinutes(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h < 24 ? h * 60 + Number(m[2] || 0) : null;
}

function timeLabel(raw) {
  const mins = timeMinutes(raw);
  if (mins === null) return String(raw || '');
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function buildDate() {
  return process.env.BUILD_DATE
    || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function nextShows(shows, today) {
  return shows
    .filter((s) => s && s.title && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && s.date >= today)
    .map((s) => ({ s, mins: timeMinutes(s.time) ?? 24 * 60 }))
    .sort((a, b) => a.s.date.localeCompare(b.s.date) || a.mins - b.mins
      || String(a.s.title).localeCompare(String(b.s.title)))
    .slice(0, MAX_SHOWS)
    .map((x) => x.s);
}

function showRow(s, showVenue) {
  const title = String(s.title);
  const people = (Array.isArray(s.comedians) ? s.comedians : [])
    .filter((name) => !title.toLowerCase().includes(String(name).toLowerCase()));
  const parts = [`<b>${escText(title)}</b>`, escText(dateLabel(s.date))];
  const time = timeLabel(s.time);
  if (time) parts.push(escText(time));
  if (showVenue && s.venue) parts.push(escText(String(s.venue)));
  if (people.length) parts.push(`with ${escText(people.join(', '))}`);
  if (/^https?:\/\//i.test(s.url || '')) {
    parts.push(`<a href="${escAttr(s.url)}" rel="nofollow noopener">Tickets</a>`);
  }
  return `<li>${parts.join(' · ')}</li>`;
}

function venueBlock(key, entry) {
  const spansClubs = !CLUB_CACHES[key] && key !== 'cellar' && key !== 'big-shows';
  const rows = nextShows(showsForView(key), buildDate()).map((s) => showRow(s, spansClubs || key === 'big-shows'));
  const list = rows.length ? `\n  <ol id="venue-shows">\n    ${rows.join('\n    ')}\n  </ol>` : '';
  return `<section id="venue-static" class="venue-static" aria-label="${escAttr(entry.h1)}">
  <h1>${escText(entry.h1)}</h1>${list}
  <script>(function(){var l=document.getElementById('venue-shows');if(l)l.remove();document.getElementById('venue-static').classList.add('venue-static-js')})();</script>
</section>

  `;
}

// Left to right, so a comment that holds "<script" is removed whole and a script
// that holds "<!--" is kept whole.
function stripHtmlComments(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>|[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/gi,
    (m) => (/^<script/i.test(m) ? m : ''));
}

// Each rule must match exactly once in index.html, or the build fails — a
// silent miss would ship a venue page that still claims to be the home page.
function venuePage(html, entry, key) {
  const url = ORIGIN + entry.path;
  const title = escAttr(entry.title);
  const desc = escAttr(entry.description);
  const rules = [
    [/<title>[^<]*<\/title>/g, `<title>${escText(entry.title)}</title>`],
    [/<meta property="og:title" content="[^"]*">/g, `<meta property="og:title" content="${title}">`],
    [/<meta name="twitter:title" content="[^"]*">/g, `<meta name="twitter:title" content="${title}">`],
    [/<meta property="og:url" content="[^"]*">/g, `<meta property="og:url" content="${url}">`],
    [/<link rel="canonical" href="[^"]*">/g, `<link rel="canonical" href="${url}">`],
    [/<meta name="description" content="[^"]*">/g, `<meta name="description" content="${desc}">`],
    [/<meta property="og:description" content="[^"]*">/g, `<meta property="og:description" content="${desc}">`],
    [/<meta name="twitter:description" content="[^"]*">/g, `<meta name="twitter:description" content="${desc}">`],
    // One H1 per page: the venue's, in the block below. The header keeps its look.
    [/<h1>Tonight <span class="accent">NYC<\/span><\/h1>/g, '<div class="site-title">Tonight <span class="accent">NYC</span></div>'],
    [/<main id="shows-container"/g, `${venueBlock(key, entry)}<main id="shows-container"`],
  ];
  let out = html;
  for (const [re, replacement] of rules) {
    const hits = (out.match(re) || []).length;
    if (hits !== 1) fail(`${re} matched ${hits} times in index.html (want 1) for ${entry.path}`);
    out = out.replace(re, () => replacement);
  }
  return stripHtmlComments(out);
}

// Same changefreq/priority the hand-written sitemap used.
function sitemapEntry(entry) {
  if (entry.path === '/') return { loc: ORIGIN, changefreq: 'daily', priority: '1.0' };
  if (entry.path === '/tonight') return { loc: ORIGIN + entry.path, changefreq: 'daily', priority: '0.9' };
  if (entry.path === '/comics') return { loc: ORIGIN + entry.path, changefreq: 'daily', priority: '0.7' };
  return { loc: ORIGIN + entry.path, changefreq: 'daily', priority: '0.8' };
}

function sitemap(meta) {
  const urls = Object.values(meta).map(sitemapEntry).concat([
    { loc: `${ORIGIN}/support`, changefreq: 'monthly', priority: '0.3' },
    { loc: `${ORIGIN}/privacy`, changefreq: 'monthly', priority: '0.3' },
  ]);
  const body = urls.map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>\n`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- Generated by scripts/build-pages.js from VIEW_META in src/init.js. Do not edit by hand. -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}</urlset>\n`;
}

function main() {
  const meta = loadViewMeta();
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (const [key, entry] of Object.entries(meta)) {
    if (key === 'all') continue;
    const slug = entry.path.replace(/^\//, '');
    if (!/^[a-z0-9-]+$/.test(slug)) fail(`VIEW_META['${key}'].path '${entry.path}' is not a simple /slug`);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), venuePage(html, entry, key));
    written.push(`${slug}.html`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemap(meta));
  console.log(`build-pages: wrote ${written.length} venue pages + sitemap.xml to ${path.relative(ROOT, OUT_DIR) || '.'}`);
}

main();

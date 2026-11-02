// Static venue pages + sitemap from scripts/build-pages.js. Google reads the
// raw <head>, so each venue URL must ship its own canonical and title — not
// the home page's (which is why the 9 venue URLs never got indexed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://tonightnyc.com';
const HOME_TITLE = 'Tonight NYC — Comedy Lineups';

const initSource = fs.readFileSync(path.join(ROOT, 'src/init.js'), 'utf8');
const VIEW_META = vm.runInNewContext(`(${initSource.match(/const VIEW_META = (\{[\s\S]*?\n\});/)[1]})`);
const venues = Object.entries(VIEW_META).filter(([key]) => key !== 'all').map(([, e]) => e);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-pages-'));
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-pages.js')], {
  env: { ...process.env, OUT_DIR: outDir },
  stdio: 'ignore',
});
test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

const attr = (html, re) => (html.match(re) || [])[1];
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

test('every VIEW_META entry has a description of at most 155 chars', () => {
  for (const [key, e] of Object.entries(VIEW_META)) {
    assert.ok(e.description && e.description.length <= 155, `${key}: ${e.description}`);
  }
});

test('each venue page has its own canonical, title, description and og:url', () => {
  assert.equal(venues.length, 9);
  for (const e of venues) {
    const html = fs.readFileSync(path.join(outDir, `${e.path.slice(1)}.html`), 'utf8');
    const url = ORIGIN + e.path;
    assert.equal(attr(html, /<link rel="canonical" href="([^"]*)">/), url, e.path);
    assert.equal(unescape(attr(html, /<title>([^<]*)<\/title>/)), e.title, e.path);
    assert.equal(unescape(attr(html, /<meta name="description" content="([^"]*)">/)), e.description, e.path);
    assert.equal(attr(html, /<meta property="og:url" content="([^"]*)">/), url, e.path);
    assert.equal(unescape(attr(html, /<meta property="og:title" content="([^"]*)">/)), e.title, e.path);
    assert.equal(unescape(attr(html, /<meta name="twitter:title" content="([^"]*)">/)), e.title, e.path);
    assert.ok(!html.includes(HOME_TITLE), `${e.path} still carries the home title`);
  }
});

test('build-pages is idempotent', () => {
  const before = fs.readdirSync(outDir).map((f) => fs.readFileSync(path.join(outDir, f), 'utf8'));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-pages.js')], {
    env: { ...process.env, OUT_DIR: outDir },
    stdio: 'ignore',
  });
  const after = fs.readdirSync(outDir).map((f) => fs.readFileSync(path.join(outDir, f), 'utf8'));
  assert.deepEqual(after, before);
});

// ---- The static venue H1 + show list ----------------------------------------
const pageHtml = (e) => fs.readFileSync(path.join(outDir, `${e.path.slice(1)}.html`), 'utf8');

test('each venue page has one H1, the venue name, and no HTML comments', () => {
  for (const e of venues) {
    const html = pageHtml(e);
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1]);
    assert.deepEqual(h1s.map(unescape), [e.h1], e.path);
    assert.ok(!/<!--/.test(html.replace(/<script\b[\s\S]*?<\/script>/g, '')), `${e.path} has an HTML comment`);
    assert.match(html, /<div class="site-title">Tonight <span class="accent">NYC<\/span><\/div>/, e.path);
    assert.match(html, /google-site-verification/, `${e.path} lost the Search Console tag`);
  }
});

test('the home page keeps its own H1', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<h1>Tonight <span class="accent">NYC<\/span><\/h1>/);
  assert.ok(!html.includes('insights job'));
});

function buildWithCaches(caches, buildDate) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-pages-cache-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'build-pages-out-'));
  for (const [file, body] of Object.entries(caches)) {
    fs.writeFileSync(path.join(cacheDir, file), typeof body === 'string' ? body : JSON.stringify(body));
  }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-pages.js')], {
    env: { ...process.env, OUT_DIR: out, CACHE_DIR: cacheDir, BUILD_DATE: buildDate },
    stdio: 'ignore',
  });
  const read = (slug) => fs.readFileSync(path.join(out, `${slug}.html`), 'utf8');
  fs.rmSync(cacheDir, { recursive: true, force: true });
  test.after(() => fs.rmSync(out, { recursive: true, force: true }));
  return read;
}

const titlesIn = (html) => [...html.matchAll(/<li><b>([^<]*)<\/b>/g)].map((m) => m[1]);

test('the list holds the next 10 shows in date and time order, from today on', () => {
  const shows = [
    { title: 'Yesterday', date: '2026-11-01', time: '8:00 PM', url: 'https://x.test/old' },
    { title: 'Late', date: '2026-11-02', time: '9:30 PM', url: 'https://x.test/late' },
    { title: 'Early', date: '2026-11-02', time: '19:00', url: 'https://x.test/early' },
    ...Array.from({ length: 12 }, (_, i) => ({
      title: `Later ${String(i).padStart(2, '0')}`, date: '2026-11-05', time: '8:00 PM', url: 'https://x.test/l',
    })),
  ];
  const html = buildWithCaches({ 'unionhall-cache.json': { shows } }, '2026-11-02')('unionhall');
  const titles = titlesIn(html);
  assert.equal(titles.length, 10);
  assert.deepEqual(titles.slice(0, 3), ['Early', 'Late', 'Later 00']);
  assert.ok(!titles.includes('Yesterday'));
  assert.match(html, /<li><b>Early<\/b> · Mon, Nov 2 · 7:00 PM · <a href="https:\/\/x\.test\/early" rel="nofollow noopener">Tickets<\/a><\/li>/);
});

test('show text is escaped and a non-http link is dropped', () => {
  const shows = [{ title: 'A <img src=x onerror=1> & B', date: '2026-11-02', time: '8:00 PM', url: 'javascript:alert(1)' }];
  const html = buildWithCaches({ 'unionhall-cache.json': { shows } }, '2026-11-02')('unionhall');
  assert.ok(html.includes('<b>A &lt;img src=x onerror=1> &amp; B</b>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:alert'));
});

test('the Cellar list reads its show HTML, with lineup and booking link', () => {
  const set = '<div><div class="set-header"><div class="info"><span class="bold">7:00 pm<span class="hide-mobile"> show</span></span>'
    + '<span class="title">Fat Black &amp; Co</span></div></div><span class="name">Dave Attell</span> bio'
    + '<div class="make-reservation"><a href="/reservations-newyork/?showid=17">Make A Reservation</a></div></div>';
  const html = buildWithCaches(
    { 'cellar-cache.json': { results: { '2026-11-02': { show: { html: set } } } } }, '2026-11-02')('cellar');
  assert.match(html, /<li><b>Fat Black &amp; Co<\/b> · Mon, Nov 2 · 7:00 PM · with Dave Attell · <a href="https:\/\/www\.comedycellar\.com\/reservations-newyork\/\?showid=17"/);
});

test('/tonight spans every club and names the venue', () => {
  const read = buildWithCaches({
    'unionhall-cache.json': { shows: [{ title: 'UH', date: '2026-11-02', time: '8:00 PM', venue: 'Union Hall', url: '' }] },
    'gotham-cache.json': { shows: [{ title: 'GO', date: '2026-11-02', time: '7:00 PM', venue: 'Gotham Comedy Club', url: '' }] },
  }, '2026-11-02');
  assert.deepEqual(titlesIn(read('tonight')), ['GO', 'UH']);
  assert.match(read('tonight'), /<b>UH<\/b> · Mon, Nov 2 · 8:00 PM · Union Hall/);
  assert.deepEqual(titlesIn(read('unionhall')), ['UH']);
});

test('a missing or broken cache leaves the H1 and never fails the build', () => {
  const read = buildWithCaches({ 'unionhall-cache.json': '{not json' }, '2026-11-02');
  const html = read('unionhall');
  assert.match(html, /<h1>Union Hall<\/h1>/);
  assert.ok(!html.includes('<ol id="venue-shows">'));
  assert.match(read('gotham'), /<h1>Gotham Comedy Club<\/h1>/);
});

test('vercel.json rewrites each venue path to its own page', () => {
  const { rewrites } = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const e of venues) {
    const rule = rewrites.find((r) => r.source === e.path);
    assert.ok(rule, `no rewrite for ${e.path}`);
    assert.equal(rule.destination, `${e.path}.html`);
  }
  assert.ok(!rewrites.some((r) => r.destination === '/index.html'), 'a path still rewrites to /index.html');
});

test('sitemap lists exactly the 12 URLs', () => {
  const xml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [
    ORIGIN,
    ...venues.map((e) => ORIGIN + e.path),
    `${ORIGIN}/support`,
    `${ORIGIN}/privacy`,
  ]);
  assert.equal(locs.length, 12);
});

test('settings footer links are extensionless', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const footer = html.match(/<p class="settings-legal">[\s\S]*?<\/p>/)[0];
  assert.ok(!/href="[^"]*\.html/.test(footer), footer);
  assert.match(footer, /href="\/support#feedback"/);
  assert.match(footer, /href="\/privacy"/);
});

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

// A scraper that fails must not blank a venue on tonightnyc.com.
//
// 2026-11-09 10:50 PM ET: gothamcomedyclub.com gave one 503. scrapeGotham() caught
// it and returned [], and the prebake wrote that over 107 good shows, so the site
// showed 0 Gotham shows while the GitHub run stayed green.
//
// These tests run the real scripts/prebake.js in a temp copy of the repo with every
// network call stubbed to fail, so nothing touches public/data in this checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Preload: every http/https request errors on the next tick, and global fetch rejects.
const OFFLINE_STUB = `
const { EventEmitter } = require('events');
const offline = () => {
  const req = new EventEmitter();
  req.setTimeout = () => req; req.destroy = () => {}; req.write = () => {}; req.end = () => {};
  process.nextTick(() => req.emit('error', new Error('stub: offline')));
  return req;
};
for (const mod of [require('http'), require('https')]) { mod.get = offline; mod.request = offline; }
globalThis.fetch = async () => { throw new Error('stub: offline'); };
`;

function makeSandbox(caches = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-last-good-'));
  const notLog = (src) => !src.endsWith('.log');
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true, filter: notLog });
  fs.cpSync(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'public', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public', 'photos'));
  const dataDir = path.join(dir, 'public', 'data');
  fs.writeFileSync(path.join(dataDir, 'comedians.json'), '[]\n');
  fs.writeFileSync(path.join(dataDir, 'photo-manifest.json'), '{}\n');
  for (const [file, body] of Object.entries(caches)) {
    fs.writeFileSync(path.join(dataDir, file), JSON.stringify(body) + '\n');
  }
  fs.writeFileSync(path.join(dir, 'offline-stub.js'), OFFLINE_STUB);
  return dir;
}

function bakeOffline(dir) {
  execFileSync(process.execPath, ['--require', path.join(dir, 'offline-stub.js'), path.join(dir, 'scripts', 'prebake.js')], {
    cwd: dir,
    env: { ...process.env, SEATGEEK_CLIENT_ID: '', TM_API_KEY: '' },
    stdio: 'ignore',
    timeout: 60000,
  });
}

const readCache = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, 'public', 'data', file), 'utf8'));

const OLD_STAMP = '2026-11-09T22:05:00.000Z';
function gothamShow(date, time) {
  return { title: `Gotham show ${date} ${time}`, date, time, venue: 'Gotham Comedy Club', price: null,
    url: `https://gothamcomedyclub.com/event/${date}-${time.replace(/\W/g, '')}`, description: '', image: '' };
}

test('a failed Gotham scrape keeps the last good list and the old prebaked stamp', (t) => {
  const today = todayNY();
  const future = [gothamShow(addDays(today, 1), '7:30 PM'), gothamShow(addDays(today, 2), '9:30 PM'), gothamShow(addDays(today, 5), '8:00 PM')];
  const past = gothamShow(addDays(today, -2), '8:00 PM');
  const dir = makeSandbox({
    'gotham-cache.json': { shows: [past, ...future], count: 4, source: 'gothamcomedyclub.com', prebaked: OLD_STAMP },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  bakeOffline(dir);
  const g = readCache(dir, 'gotham-cache.json');
  assert.equal(g.shows.length, 3, `expected the 3 future shows to stay, got ${g.shows.length}`);
  assert.deepEqual(g.shows.map(s => s.date), future.map(s => s.date));
  assert.equal(g.count, 3);
  assert.equal(g.prebaked, OLD_STAMP, 'the old stamp must stay so the health job still flags a venue that keeps failing');
  assert.equal(g.keptFrom, OLD_STAMP);
  assert.equal(g.source, 'gothamcomedyclub.com');
});

test('every club cache and big shows keep the last good list; a venue with nothing to keep writes []', (t) => {
  const today = todayNY();
  const show = (venue) => ({ title: `${venue} show`, date: addDays(today, 1), time: '8:00 PM', venue, url: `https://example.com/${encodeURIComponent(venue)}` });
  const dir = makeSandbox({
    'stand-cache.json': { shows: [show('The Stand NYC')], count: 1, source: 'thestandnyc.com', prebaked: OLD_STAMP },
    'nycc-cache.json': { shows: [show('NY Comedy Club')], count: 1, source: 'newyorkcomedyclub.com', prebaked: OLD_STAMP },
    'standupny-cache.json': { shows: [show('Stand Up NY')], count: 1, source: 'standupny.com', prebaked: OLD_STAMP },
    'unionhall-cache.json': { shows: [show('Union Hall')], count: 1, source: 'unionhallny.com (Eventbrite)', prebaked: OLD_STAMP },
    'big-shows-cache.json': { events: [show('Beacon Theatre')], count: 1, source: 'seatgeek.com+ticketmaster.com', prebaked: OLD_STAMP },
    // Gotham's last list is all in the past: nothing to keep, so it writes [] with a fresh stamp.
    'gotham-cache.json': { shows: [gothamShow(addDays(today, -1), '8:00 PM')], count: 1, source: 'gothamcomedyclub.com', prebaked: OLD_STAMP },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  bakeOffline(dir);
  for (const [file, key] of [['stand-cache.json', 'shows'], ['nycc-cache.json', 'shows'], ['standupny-cache.json', 'shows'],
    ['unionhall-cache.json', 'shows'], ['big-shows-cache.json', 'events']]) {
    const c = readCache(dir, file);
    assert.equal(c[key].length, 1, `${file} lost its last good list`);
    assert.equal(c.prebaked, OLD_STAMP, `${file} stamp moved`);
  }
  const g = readCache(dir, 'gotham-cache.json');
  assert.deepEqual(g.shows, []);
  assert.notEqual(g.prebaked, OLD_STAMP);
  assert.equal(g.keptFrom, undefined);
});

test('kept shows add no duplicate rows to the past-shows archive', (t) => {
  const today = todayNY();
  const future = [gothamShow(addDays(today, 1), '7:30 PM'), gothamShow(addDays(today, 1), '9:30 PM'), gothamShow(addDays(today, 3), '8:00 PM')];
  const dir = makeSandbox({
    'gotham-cache.json': { shows: future, count: 3, source: 'gothamcomedyclub.com', prebaked: OLD_STAMP },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const archivedGotham = () => {
    const archiveDir = path.join(dir, 'public', 'data', 'archive');
    let n = 0;
    for (const f of fs.readdirSync(archiveDir).filter(f => /^\d{4}-\d{2}\.json$/.test(f))) {
      const days = JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf8')).days || {};
      for (const day of Object.values(days)) n += (day.gotham || []).length;
    }
    return n;
  };
  bakeOffline(dir);
  assert.equal(archivedGotham(), 3);
  bakeOffline(dir);
  assert.equal(archivedGotham(), 3, 'a second failed bake must not add the kept shows again');
});

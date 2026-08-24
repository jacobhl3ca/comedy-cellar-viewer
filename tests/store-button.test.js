const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const accountSource = fs.readFileSync(path.join(__dirname, '../src/account.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const STORE_HIDDEN_KEY = 'tonight-nyc-store-hidden';

function element() {
  return { hidden: false, disabled: false, textContent: '', classList: { toggle() {} }, addEventListener() {} };
}

// Drive account.js to its /api/me render with the answer this test cares about,
// and hand back the header button plus whatever landed in localStorage.
async function boot(me) {
  const store = new Map();
  const storeBtn = element();
  const context = {
    URLSearchParams, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'test-nonce' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    fetch: async url => (String(url).includes('/api/me')
      ? { ok: true, json: async () => me }
      : { ok: true, json: async () => ({}) }),
    document: {
      visibilityState: 'visible',
      getElementById: id => (id === 'header-appstore' ? storeBtn : element()),
      querySelector: () => element(),
      addEventListener() {},
    },
    window: { Capacitor: undefined, addEventListener() {}, location: { search: '', href: '', reload() {} } },
  };
  vm.runInNewContext(accountSource, context);
  await new Promise(resolve => setImmediate(resolve));
  return { storeBtn, store };
}

test('an account that has used the app on either platform loses the store button', async () => {
  for (const platforms of [{ ios: '2026-08-01' }, { android: '2026-08-01' }, { ios: '2026-08-01', android: '2026-08-02' }]) {
    const { storeBtn, store } = await boot({ signedIn: true, platforms, providers: { apple: true } });
    assert.equal(storeBtn.hidden, true, `still showing for ${JSON.stringify(platforms)}`);
    assert.equal(store.get(STORE_HIDDEN_KEY), '1', 'the answer has to be remembered for the next load');
  }
});

test('a web-only account and an anonymous visitor keep it', async () => {
  const web = await boot({ signedIn: true, platforms: { web: '2026-08-24' }, providers: { apple: true } });
  assert.equal(web.storeBtn.hidden, false);
  assert.equal(web.store.get(STORE_HIDDEN_KEY), '0', 'false is an answer too — it un-hides on the next load');

  const anon = await boot({ signedIn: false, providers: { apple: true } });
  assert.equal(anon.storeBtn.hidden, false, 'we cannot know an anonymous visitor installed it');
  assert.equal(anon.store.get(STORE_HIDDEN_KEY), '0');
});

test('the pre-paint script in index.html replays the same key', async () => {
  // The contract lives in two files with a bare string between them. Renaming
  // the key on one side fails silently — the button just flashes again.
  assert.match(accountSource, new RegExp(`STORE_HIDDEN_KEY = '${STORE_HIDDEN_KEY}'`), 'account.js owns the key');
  assert.ok(indexHtml.includes(`localStorage.getItem('${STORE_HIDDEN_KEY}')`), 'index.html must read that exact key');

  // It must run inline in the document, NOT from the deferred app.min.js, or it
  // is not pre-paint and there is no point to any of this.
  const buttonAt = indexHtml.indexOf('id="header-appstore"');
  const replayAt = indexHtml.indexOf(`localStorage.getItem('${STORE_HIDDEN_KEY}')`);
  assert.ok(buttonAt > -1 && replayAt > buttonAt, 'the replay must sit after the button it hides');
  assert.ok(replayAt < indexHtml.indexOf('app.min.js'), 'and before the deferred bundle');

  // Hides only. The markup default is visible, so a stale flag can never leave
  // someone unable to reach the store — the real answer only ever un-hides.
  const snippet = indexHtml.slice(replayAt - 200, replayAt + 300);
  assert.match(snippet, /!== '1'\) return/, 'anything other than a remembered 1 leaves the button alone');
  assert.ok(!/hidden = false/.test(snippet), 'the pre-paint script must never un-hide');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const accountSource = fs.readFileSync(path.join(__dirname, '../src/account.js'), 'utf8');

function element() {
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    classList: { toggle() {} },
    addEventListener() {},
  };
}

test('released native shell keeps bridge-free email sign-in available', async () => {
  const accountSection = element();
  let fetchCount = 0;
  const context = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => 'test-nonce' },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ signedIn: false, providers: { apple: true, google: true, email: true } }) };
    },
    document: {
      visibilityState: 'visible',
      getElementById: () => element(),
      querySelector: selector => selector === '.account-section' ? accountSection : null,
      addEventListener() {},
    },
    window: {
      Capacitor: { isNativePlatform: () => true, Plugins: {} },
      addEventListener() {},
      location: { search: '', href: '', reload() {} },
    },
  };

  vm.runInNewContext(accountSource, context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(accountSection.hidden, false);
  assert.equal(fetchCount, 1);
  assert.doesNotMatch(accountSource, /Update Tonight NYC from the App Store/);
  assert.match(accountSource, /\/api\/auth\/email\/request/);
});

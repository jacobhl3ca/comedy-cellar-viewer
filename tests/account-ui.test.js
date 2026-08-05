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

test('released native shell hides unavailable account controls without requesting an update', async () => {
  const accountSection = element();
  let fetchCount = 0;
  const context = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => 'test-nonce' },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => { fetchCount += 1; throw new Error('unexpected fetch'); },
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

  assert.equal(accountSection.hidden, true);
  assert.equal(fetchCount, 0);
  assert.doesNotMatch(accountSource, /Update Tonight NYC from the App Store/);
});

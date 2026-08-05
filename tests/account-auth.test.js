const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../server/account-auth');
const auth = require('../server/account-auth');

function request(method, headers = {}) {
  return { method, headers, query: {}, [Symbol.asyncIterator]: async function* () {} };
}

function response() {
  const headers = {};
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
    headers,
  };
}

test('signed tokens round-trip and reject tampering', () => {
  const token = _test.makeSignedToken('test-secret', { sub: 'apple:123', exp: 42 });
  assert.deepEqual(_test.readSignedToken('test-secret', token), { sub: 'apple:123', exp: 42 });
  assert.equal(_test.readSignedToken('wrong-secret', token), null);
  assert.equal(_test.readSignedToken('test-secret', `${token}x`), null);
});

test('return paths cannot escape to another origin', () => {
  assert.equal(_test.safeReturnTo('/settings'), '/settings');
  assert.equal(_test.safeReturnTo('//evil.example'), '/');
  assert.equal(_test.safeReturnTo('/\\evil.example'), '/');
  assert.equal(_test.safeReturnTo('/ok\nLocation: https://evil.example'), '/');
  assert.equal(_test.safeReturnTo('https://evil.example'), '/');
  assert.equal(_test.safeReturnTo(null), '/');
});

test('sync payloads are allowlisted and normalized', () => {
  const clean = _test.cleanSyncPayload({
    prefs: {
      faves: [' Dave Attell ', 'Dave Attell', 42],
      skips: ['Example'],
      likes: [],
      injected: ['nope'],
    },
    settings: {
      accent: '#e63636',
      hiddenTabs: ['gotham', 'gotham'],
      unknown: 'drop me',
      defaultTab: 7,
    },
  });
  assert.deepEqual(clean, {
    version: 1,
    prefs: { faves: ['Dave Attell'], skips: ['Example'], likes: [] },
    settings: { accent: '#e63636', hiddenTabs: ['gotham'] },
  });
});

test('sync payloads reject missing or non-object sections', () => {
  assert.equal(_test.cleanSyncPayload(null), null);
  assert.equal(_test.cleanSyncPayload({ prefs: [], settings: {} }), null);
  assert.equal(_test.cleanSyncPayload({ prefs: {}, settings: null }), null);
});

test('account discovery stays inert when Apple is not configured', async () => {
  const res = response();
  await auth.handleMe(request('GET'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    signedIn: false,
    email: null,
    uid: null,
    providers: { apple: false },
    store: { sync: false },
  });
});

test('auth and sync routes fail closed', async () => {
  const login = response();
  await auth.handleLogin(request('GET'), login);
  assert.equal(login.statusCode, 503);

  const prefs = response();
  await auth.handlePrefs(request('GET'), prefs);
  assert.equal(prefs.statusCode, 401);

  const logout = response();
  await auth.handleLogout(request('POST', { origin: 'https://evil.example' }), logout);
  assert.equal(logout.statusCode, 403);
});

test('same-origin logout clears the signed session cookie', async () => {
  const res = response();
  await auth.handleLogout(request('POST', { origin: 'https://tonightnyc.com' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /^tonight_session=;/);
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers['set-cookie'], /SameSite=Lax/);
});

test('account identity comes only from a valid signed cookie', async () => {
  const priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-session-secret';
  try {
    const token = _test.makeSignedToken(process.env.SESSION_SECRET, {
      sub: 'apple:user-a',
      email: 'a@example.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const valid = response();
    const validReq = request('GET', { cookie: `tonight_session=${token}` });
    validReq.query = { uid: 'user-b' };
    await auth.handleMe(validReq, valid);
    const body = JSON.parse(valid.body);
    assert.equal(body.signedIn, true);
    assert.equal(body.email, 'a@example.com');
    assert.notEqual(body.uid, 'user-b');

    const tampered = response();
    await auth.handleMe(request('GET', { cookie: `tonight_session=${token}x` }), tampered);
    assert.equal(JSON.parse(tampered.body).signedIn, false);
  } finally {
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
  }
});

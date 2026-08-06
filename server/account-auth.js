const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');

const APPLE_AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS = 'https://appleid.apple.com/auth/keys';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_COOKIE = 'tonight_session';
const SESSION_TTL = 60 * 60 * 24 * 90;
const STATE_TTL = 60 * 10;
const PREVIOUS_TTL = 60 * 60 * 24 * 30;
const MAX_BODY = 64 * 1024;
const SETTINGS_KEYS = new Set([
  'accent', 'defaultTab', 'scheduleDay', 'neighborhood', 'soldOutMode',
  'timeFilter', 'sort', 'bioMode', 'ratingsMode', 'priceMode',
  'hiddenTabs', 'hiddenTools', 'allHidden',
]);

let redis;
let appleKeysCache;
let googleKeysCache;

function getStore() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  return redis;
}

function appleConfigured() {
  return Boolean(
    process.env.APPLE_SERVICES_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY &&
    process.env.SESSION_SECRET,
  );
}

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET);
}

function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function redirect(res, status, location, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end();
}

function b64url(input) {
  const value = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return value.toString('base64url');
}

function parseB64Json(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function hmac(secret, value) {
  return b64url(crypto.createHmac('sha256', secret).update(value).digest());
}

function makeSignedToken(secret, payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(secret, body)}`;
}

function readSignedToken(secret, token) {
  if (!secret || !token || !token.includes('.')) return null;
  const dot = token.lastIndexOf('.');
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(secret, body);
  if (signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { return parseB64Json(body); } catch { return null; }
}

function makeSession(payload) {
  return makeSignedToken(process.env.SESSION_SECRET, payload);
}

function readSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  const session = readSignedToken(process.env.SESSION_SECRET, token);
  if (!session || !session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  return session;
}

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
    !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value) ? value : '/';
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function canonicalOrigin() {
  const value = process.env.APP_ORIGIN || 'https://tonightnyc.com';
  return value.replace(/\/$/, '');
}

function mutationAllowed(req) {
  if ((req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'tonightnyc.com' || host === 'www.tonightnyc.com' || host === '127.0.0.1' || host === 'localhost';
  } catch { return false; }
}

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > MAX_BODY) throw new Error('too_large');
  }
  return value;
}

async function jsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new Error('too_large');
    return req.body;
  }
  const raw = await rawBody(req);
  if (raw.length > MAX_BODY) throw new Error('too_large');
  return JSON.parse(raw || '{}');
}

async function formBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  return Object.fromEntries(new URLSearchParams(await rawBody(req)));
}

function privateKey() {
  return process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
}

function appleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APPLE_KEY_ID }));
  const payload = b64url(JSON.stringify({
    iss: process.env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: process.env.APPLE_SERVICES_ID,
  }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(input), {
    key: privateKey(),
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${b64url(signature)}`;
}

async function appleJwks() {
  if (appleKeysCache && appleKeysCache.expires > Date.now()) return appleKeysCache.keys;
  const response = await fetch(APPLE_KEYS);
  if (!response.ok) throw new Error('apple_keys');
  const { keys } = await response.json();
  appleKeysCache = { keys, expires: Date.now() + 60 * 60 * 1000 };
  return keys;
}

async function verifyAppleToken(token, audience) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = parseB64Json(parts[0]);
    claims = parseB64Json(parts[1]);
  } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const jwk = (await appleJwks()).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!verified || claims.iss !== 'https://appleid.apple.com') return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (!audiences.includes(audience) || !claims.exp || claims.exp < now || (claims.iat && claims.iat > now + 60)) return null;
  return claims;
}

async function googleJwks() {
  if (googleKeysCache && googleKeysCache.expires > Date.now()) return googleKeysCache.keys;
  const response = await fetch(GOOGLE_KEYS);
  if (!response.ok) throw new Error('google_keys');
  const { keys } = await response.json();
  googleKeysCache = { keys, expires: Date.now() + 60 * 60 * 1000 };
  return keys;
}

async function verifyGoogleToken(token, audience) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try { header = parseB64Json(parts[0]); claims = parseB64Json(parts[1]); }
  catch { return null; }
  if (header.alg !== 'RS256') return null;
  const jwk = (await googleJwks()).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!verified || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== audience || !claims.exp || claims.exp < now || (claims.iat && claims.iat > now + 60)) return null;
  return claims;
}

function uidForSub(sub) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`uid:${sub}`).digest('hex').slice(0, 24);
}

function privateIndex(kind, value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`${kind}:${value}`).digest('base64url').slice(0, 32);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeStored(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function resolveAccount(store, identity, linkUid = null) {
  const identityKey = `tn:identity:${privateIndex('identity', identity.sub)}`;
  const existingIdentity = normalizeStored(await store.get(identityKey));
  if (linkUid && existingIdentity?.uid && existingIdentity.uid !== linkUid) {
    throw new Error('identity_already_linked');
  }
  let uid = linkUid || existingIdentity?.uid || null;
  let emailKey = null;
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : null;
  if (!uid && email && identity.emailVerified !== false) {
    emailKey = `tn:email:${privateIndex('email', email)}`;
    uid = normalizeStored(await store.get(emailKey))?.uid || null;
  }
  uid = uid || uidForSub(identity.sub);

  const accountKey = `tn:account:${uid}`;
  const prior = normalizeStored(await store.get(accountKey)) || {};
  const identities = Array.isArray(prior.identities) ? prior.identities.filter((value) => typeof value === 'string') : [];
  if (!identities.includes(identity.sub)) identities.push(identity.sub);
  const linkedProviders = [...new Set(identities.map((sub) => sub.split(':')[0]).filter(Boolean))];
  const account = {
    ...prior,
    uid,
    email: email || prior.email || null,
    identities,
    linkedProviders,
    createdAt: prior.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.set(identityKey, { uid });
  if (email && identity.emailVerified !== false) {
    emailKey = emailKey || `tn:email:${privateIndex('email', email)}`;
    const mapped = normalizeStored(await store.get(emailKey));
    if (!mapped?.uid || mapped.uid === uid) await store.set(emailKey, { uid });
  }
  await store.set(accountKey, account);

  // Existing Apple users already have sync data at the provider-derived uid.
  // Copy it only when linking onto a different canonical uid, and retain the
  // old object as the rollback copy.
  const legacyUid = uidForSub(identity.sub);
  if (legacyUid !== uid && !normalizeStored(await store.get(`tn:sync:${uid}`))) {
    const legacy = normalizeStored(await store.get(`tn:sync:${legacyUid}`));
    if (legacy) await store.set(`tn:sync:${uid}`, legacy);
  }
  return account;
}

function cleanNames(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim().slice(0, 100))
    .filter(Boolean))].slice(0, 250);
}

function cleanSyncPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const prefsInput = input.prefs;
  const settingsInput = input.settings;
  if (!prefsInput || typeof prefsInput !== 'object' || Array.isArray(prefsInput)) return null;
  if (!settingsInput || typeof settingsInput !== 'object' || Array.isArray(settingsInput)) return null;
  const prefs = {
    faves: cleanNames(prefsInput.faves),
    skips: cleanNames(prefsInput.skips),
    likes: cleanNames(prefsInput.likes),
  };
  const settings = {};
  for (const [key, value] of Object.entries(settingsInput)) {
    if (!SETTINGS_KEYS.has(key)) continue;
    if (typeof value === 'string') settings[key] = value.slice(0, 100);
    else if (Array.isArray(value)) settings[key] = cleanNames(value);
  }
  return { version: 1, prefs, settings };
}

async function touchUser(store, session, account) {
  const uid = account.uid;
  const key = `tn:user:${uid}`;
  const prior = normalizeStored(await store.get(key)) || {};
  const now = new Date().toISOString();
  await store.set(key, {
    uid,
    email: session.email || prior.email || null,
    provider: session.sub.split(':')[0],
    linkedProviders: account.linkedProviders || [],
    firstSeen: prior.firstSeen || now,
    lastSeen: now,
  });
  return uid;
}

async function requireAccount(req, res) {
  const session = readSession(req);
  if (!session) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  const store = getStore();
  if (!store) {
    json(res, 503, { error: 'store_not_configured' });
    return null;
  }
  const account = await resolveAccount(store, {
    sub: session.sub,
    email: session.email,
    emailVerified: true,
  });
  return { session, store, uid: account.uid, account };
}

async function handleLogin(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!appleConfigured()) return json(res, 503, { error: 'not_configured' });
  const returnTo = safeReturnTo(req.query?.returnTo);
  const store = getStore();
  let linkUid = null;
  if (String(req.query?.link || '') === '1' && store) {
    const current = readSession(req);
    if (current) linkUid = (await resolveAccount(store, { sub: current.sub, email: current.email, emailVerified: true })).uid;
  }
  const nonce = b64url(crypto.randomBytes(20));
  const state = makeSignedToken(process.env.SESSION_SECRET, {
    nonce,
    returnTo,
    issuedAt: Math.floor(Date.now() / 1000),
    linkUid,
  });
  const auth = new URL(APPLE_AUTHORIZE);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('response_mode', 'form_post');
  auth.searchParams.set('client_id', process.env.APPLE_SERVICES_ID);
  auth.searchParams.set('redirect_uri', `${canonicalOrigin()}/api/auth/apple/callback`);
  auth.searchParams.set('scope', 'name email');
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  return redirect(res, 302, auth.toString());
}

async function handleCallback(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!appleConfigured()) return redirect(res, 303, '/?auth_error=not_configured');
  let body;
  try { body = await formBody(req); } catch { return redirect(res, 303, '/?auth_error=bad_request'); }
  const state = readSignedToken(process.env.SESSION_SECRET, body.state);
  const now = Math.floor(Date.now() / 1000);
  if (!state || !state.issuedAt || state.issuedAt < now - STATE_TTL || state.issuedAt > now + 60) {
    return redirect(res, 303, '/?auth_error=bad_state');
  }
  if (!body.code) return redirect(res, 303, '/?auth_error=missing_code');
  let tokenResponse;
  try {
    tokenResponse = await fetch(APPLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.APPLE_SERVICES_ID,
        client_secret: appleClientSecret(),
        code: String(body.code),
        grant_type: 'authorization_code',
        redirect_uri: `${canonicalOrigin()}/api/auth/apple/callback`,
      }),
    });
  } catch { return redirect(res, 303, '/?auth_error=token_exchange'); }
  if (!tokenResponse.ok) return redirect(res, 303, '/?auth_error=token_exchange');
  const tokens = await tokenResponse.json();
  const claims = await verifyAppleToken(tokens.id_token, process.env.APPLE_SERVICES_ID).catch(() => null);
  if (!claims || !claims.nonce || claims.nonce !== state.nonce) {
    return redirect(res, 303, '/?auth_error=bad_identity');
  }
  const store = getStore();
  if (!store) return redirect(res, 303, '/?auth_error=store_not_configured');
  const identity = { sub: `apple:${claims.sub}`, email: claims.email || null, emailVerified: true };
  const account = await resolveAccount(store, identity, state.linkUid || null).catch(() => null);
  if (!account) return redirect(res, 303, '/?auth_error=identity_link');
  const session = makeSession({
    sub: identity.sub,
    uid: account.uid,
    email: identity.email,
    exp: now + SESSION_TTL,
  });
  return redirect(res, 303, safeReturnTo(state.returnTo), {
    'Set-Cookie': sessionCookie(session, SESSION_TTL),
  });
}

async function handleNative(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!mutationAllowed(req)) return json(res, 403, { error: 'cross_site' });
  if (!process.env.SESSION_SECRET) return json(res, 503, { error: 'not_configured' });
  let body;
  try { body = await jsonBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
  const audience = process.env.APPLE_APP_BUNDLE_ID || 'com.jacobhl.tonightnyc';
  const claims = await verifyAppleToken(body.identityToken, audience).catch(() => null);
  if (!claims) return json(res, 401, { error: 'bad_identity' });
  if (!body.nonce || !claims.nonce || sha256Hex(body.nonce) !== claims.nonce) return json(res, 401, { error: 'bad_nonce' });
  const store = getStore();
  if (!store) return json(res, 503, { error: 'store_not_configured' });
  let linkUid = null;
  if (body.link) {
    const current = readSession(req);
    if (current) linkUid = (await resolveAccount(store, { sub: current.sub, email: current.email, emailVerified: true })).uid;
  }
  const identity = { sub: `apple:${claims.sub}`, email: claims.email || body.email || null, emailVerified: true };
  let account;
  try { account = await resolveAccount(store, identity, linkUid); }
  catch { return json(res, 409, { error: 'identity_already_linked' }); }
  const now = Math.floor(Date.now() / 1000);
  const session = makeSession({
    sub: identity.sub,
    uid: account.uid,
    email: identity.email,
    exp: now + SESSION_TTL,
  });
  return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(session, SESSION_TTL) });
}

async function handleGoogleLogin(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!googleConfigured()) return json(res, 503, { error: 'not_configured' });
  const store = getStore();
  if (!store) return json(res, 503, { error: 'store_not_configured' });
  const nativeChallengeRaw = String(req.query?.nativeChallenge || '');
  const nativeChallenge = /^[A-Za-z0-9_-]{43}$/.test(nativeChallengeRaw) ? nativeChallengeRaw : null;
  if (nativeChallengeRaw && !nativeChallenge) return json(res, 400, { error: 'bad_native_challenge' });
  let linkUid = null;
  const nativeLinkToken = String(req.query?.nativeLinkToken || '');
  if (nativeChallenge && nativeLinkToken) {
    const proof = readSignedToken(process.env.SESSION_SECRET, nativeLinkToken);
    if (!proof || proof.purpose !== 'google_link' || typeof proof.uid !== 'string' ||
        typeof proof.exp !== 'number' || proof.exp < Math.floor(Date.now() / 1000)) {
      return json(res, 400, { error: 'bad_link_token' });
    }
    linkUid = proof.uid;
  } else if (String(req.query?.link || '') === '1') {
    const current = readSession(req);
    if (current) linkUid = (await resolveAccount(store, { sub: current.sub, email: current.email, emailVerified: true })).uid;
  }
  const nonce = b64url(crypto.randomBytes(20));
  const state = makeSignedToken(process.env.SESSION_SECRET, {
    nonce,
    returnTo: safeReturnTo(req.query?.returnTo),
    nativeChallenge,
    linkUid,
    issuedAt: Math.floor(Date.now() / 1000),
  });
  const auth = new URL(GOOGLE_AUTHORIZE);
  auth.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', `${canonicalOrigin()}/api/auth/google/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  auth.searchParams.set('prompt', 'select_account');
  return redirect(res, 302, auth.toString());
}

async function handleGoogleCallback(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!googleConfigured()) return redirect(res, 303, '/?auth_error=not_configured');
  if (req.query?.error) return redirect(res, 303, '/');
  const state = readSignedToken(process.env.SESSION_SECRET, req.query?.state);
  const now = Math.floor(Date.now() / 1000);
  if (!state || !state.issuedAt || state.issuedAt < now - STATE_TTL || state.issuedAt > now + 60) {
    return redirect(res, 303, '/?auth_error=bad_state');
  }
  const code = String(req.query?.code || '');
  if (!code) return redirect(res, 303, '/?auth_error=missing_code');
  let tokenResponse;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${canonicalOrigin()}/api/auth/google/callback`,
      }),
    });
  } catch { return redirect(res, 303, '/?auth_error=token_exchange'); }
  if (!tokenResponse.ok) return redirect(res, 303, '/?auth_error=token_exchange');
  const tokens = await tokenResponse.json();
  const claims = await verifyGoogleToken(tokens.id_token, process.env.GOOGLE_CLIENT_ID).catch(() => null);
  if (!claims || claims.nonce !== state.nonce) return redirect(res, 303, '/?auth_error=bad_identity');
  const store = getStore();
  if (!store) return redirect(res, 303, '/?auth_error=store_not_configured');
  const identity = {
    sub: `google:${claims.sub}`,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
  let account;
  try { account = await resolveAccount(store, identity, state.linkUid || null); }
  catch { return redirect(res, 303, '/?auth_error=identity_already_linked'); }

  if (state.nativeChallenge) {
    const handoff = b64url(crypto.randomBytes(32));
    await store.set(`tn:handoff:${handoff}`, {
      uid: account.uid,
      sub: identity.sub,
      email: identity.email,
      challenge: state.nativeChallenge,
      returnTo: safeReturnTo(state.returnTo),
    }, { ex: 300 });
    const callback = new URL('tonight-auth://google');
    callback.searchParams.set('code', handoff);
    callback.searchParams.set('returnTo', safeReturnTo(state.returnTo));
    return redirect(res, 303, callback.toString());
  }

  const session = makeSession({
    sub: identity.sub,
    uid: account.uid,
    email: identity.email,
    exp: now + SESSION_TTL,
  });
  return redirect(res, 303, safeReturnTo(state.returnTo), { 'Set-Cookie': sessionCookie(session, SESSION_TTL) });
}

async function handleGoogleNative(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!mutationAllowed(req)) return json(res, 403, { error: 'cross_site' });
  const store = getStore();
  if (!store || !process.env.SESSION_SECRET) return json(res, 503, { error: 'not_configured' });
  let body;
  try { body = await jsonBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
  if (body.action === 'link_token') {
    const current = readSession(req);
    if (!current) return json(res, 401, { error: 'unauthorized' });
    const account = await resolveAccount(store, { sub: current.sub, email: current.email, emailVerified: true });
    return json(res, 200, {
      linkToken: makeSignedToken(process.env.SESSION_SECRET, {
        purpose: 'google_link', uid: account.uid, exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.code || '') || !/^[A-Za-z0-9_-]{43}$/.test(body.verifier || '')) {
    return json(res, 400, { error: 'bad_handoff' });
  }
  const key = `tn:handoff:${body.code}`;
  const handoff = normalizeStored(await store.get(key));
  await store.del(key);
  const challenge = b64url(crypto.createHash('sha256').update(body.verifier).digest());
  if (!handoff || challenge !== handoff.challenge) return json(res, 401, { error: 'bad_handoff' });
  const session = makeSession({
    sub: handoff.sub,
    uid: handoff.uid,
    email: handoff.email || null,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  });
  return json(res, 200, { ok: true, returnTo: safeReturnTo(handoff.returnTo) }, {
    'Set-Cookie': sessionCookie(session, SESSION_TTL),
  });
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!mutationAllowed(req)) return json(res, 403, { error: 'cross_site' });
  return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

async function handleMe(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const session = readSession(req);
  const store = getStore();
  let account = null;
  if (session && store) {
    account = await resolveAccount(store, { sub: session.sub, email: session.email, emailVerified: true }).catch(() => null);
  }
  const response = {
    signedIn: Boolean(session),
    email: session?.email || null,
    uid: account?.uid || session?.uid || (session ? uidForSub(session.sub) : null),
    provider: session?.sub?.split(':')[0] || null,
    linkedProviders: account?.linkedProviders || [],
    providers: { apple: appleConfigured() && Boolean(store), google: googleConfigured() && Boolean(store) },
    store: { sync: Boolean(store) },
  };
  if (session && store && account) await touchUser(store, session, account).catch(() => {});
  return json(res, 200, response);
}

async function handlePrefs(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  if (req.method === 'PUT' && !mutationAllowed(req)) return json(res, 403, { error: 'cross_site' });
  const account = await requireAccount(req, res);
  if (!account) return;
  const key = `tn:sync:${account.uid}`;
  if (req.method === 'GET') {
    const sync = normalizeStored(await account.store.get(key));
    await touchUser(account.store, account.session, account.account).catch(() => {});
    return json(res, 200, { sync });
  }
  let input;
  try { input = await jsonBody(req); }
  catch (error) { return json(res, error.message === 'too_large' ? 413 : 400, { error: error.message === 'too_large' ? 'too_large' : 'bad_json' }); }
  const clean = cleanSyncPayload(input);
  if (!clean) return json(res, 400, { error: 'bad_shape' });
  const prior = normalizeStored(await account.store.get(key));
  if (prior) await account.store.set(`tn:sync:previous:${account.uid}`, prior, { ex: PREVIOUS_TTL });
  const record = { ...clean, updatedAt: new Date().toISOString() };
  await account.store.set(key, record);
  await touchUser(account.store, account.session, account.account).catch(() => {});
  return json(res, 200, { ok: true, updatedAt: record.updatedAt });
}

async function handleAccount(req, res) {
  if (req.method !== 'DELETE') return json(res, 405, { error: 'method_not_allowed' });
  if (!mutationAllowed(req)) return json(res, 403, { error: 'cross_site' });
  const account = await requireAccount(req, res);
  if (!account) return;
  const deletes = [
    account.store.del(`tn:sync:${account.uid}`),
    account.store.del(`tn:sync:previous:${account.uid}`),
    account.store.del(`tn:user:${account.uid}`),
    account.store.del(`tn:account:${account.uid}`),
  ];
  for (const sub of account.account.identities || []) {
    deletes.push(account.store.del(`tn:identity:${privateIndex('identity', sub)}`));
    const legacyUid = uidForSub(sub);
    if (legacyUid !== account.uid) {
      deletes.push(account.store.del(`tn:sync:${legacyUid}`));
      deletes.push(account.store.del(`tn:sync:previous:${legacyUid}`));
      deletes.push(account.store.del(`tn:user:${legacyUid}`));
    }
  }
  if (account.account.email) deletes.push(account.store.del(`tn:email:${privateIndex('email', account.account.email)}`));
  await Promise.all(deletes);
  return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

module.exports = {
  handleAccount,
  handleCallback,
  handleLogin,
  handleGoogleCallback,
  handleGoogleLogin,
  handleGoogleNative,
  handleLogout,
  handleMe,
  handleNative,
  handlePrefs,
  _test: { cleanSyncPayload, makeSignedToken, readSignedToken, safeReturnTo },
};

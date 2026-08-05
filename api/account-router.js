const auth = require('../server/account-auth');

const HANDLERS = {
  account: auth.handleAccount,
  callback: auth.handleCallback,
  login: auth.handleLogin,
  logout: auth.handleLogout,
  me: auth.handleMe,
  native: auth.handleNative,
  prefs: auth.handlePrefs,
};

module.exports = async function accountRouter(req, res) {
  const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  const handler = HANDLERS[action];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  return handler(req, res);
};

module.exports._test = { actions: Object.keys(HANDLERS).sort() };

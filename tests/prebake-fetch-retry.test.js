// prebake fetch(): one retry on a 5xx (Gotham's one 503 on 2026-11-09 blanked the
// venue), no retry on a 404 so photo lookups stay fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.PREBAKE_RETRY_DELAY_MS = '10';
const { fetch } = require('../scripts/prebake');

function serve(handler) {
  return new Promise((resolve) => {
    const hits = {};
    const server = http.createServer((req, res) => {
      hits[req.url] = (hits[req.url] || 0) + 1;
      handler(req, res, hits[req.url]);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('a 503 retries once and returns the second answer', async (t) => {
  const { server, hits, base } = await serve((req, res, n) => {
    if (n === 1) { res.writeHead(503); return res.end('busy'); }
    res.writeHead(200); res.end('ok');
  });
  t.after(() => server.close());
  const body = await fetch(`${base}/flaky`);
  assert.equal(body.toString(), 'ok');
  assert.equal(hits['/flaky'], 2);
});

test('two 5xx in a row still fail after one retry', async (t) => {
  const { server, hits, base } = await serve((req, res) => { res.writeHead(502); res.end(); });
  t.after(() => server.close());
  await assert.rejects(fetch(`${base}/down`), /HTTP 502/);
  assert.equal(hits['/down'], 2);
});

test('a 404 does not retry', async (t) => {
  const { server, hits, base } = await serve((req, res) => { res.writeHead(404); res.end(); });
  t.after(() => server.close());
  await assert.rejects(fetch(`${base}/missing`), /HTTP 404/);
  assert.equal(hits['/missing'], 1);
});

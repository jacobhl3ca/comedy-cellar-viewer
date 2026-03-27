const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept GET with ?date=YYYY-MM-DD (cacheable) or legacy POST
  let dateStr;
  if (req.method === 'GET') {
    dateStr = req.query.date;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD' });
    }
  } else if (req.method === 'POST') {
    // Legacy POST support — still works but won't be edge-cached
    const rawBody = await new Promise(resolve => {
      let data = '';
      req.on('data', c => data += c);
      req.on('end', () => resolve(data));
    });
    try {
      const params = new URLSearchParams(rawBody);
      const json = JSON.parse(params.get('json') || '{}');
      dateStr = json.date;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid POST body' });
    }
  } else {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({
    date: dateStr, venue: 'newyork', type: 'lineup'
  }))}`;

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.comedycellar.com',
      path: '/lineup/api/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.comedycellar.com/new-york-line-up/',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const proxy = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', c => data += c);
      proxyRes.on('end', () => {
        try { res.status(200).json(JSON.parse(data)); }
        catch (e) { res.status(502).json({ error: 'Invalid JSON from Comedy Cellar' }); }
        resolve();
      });
    });

    proxy.setTimeout(12000, () => {
      proxy.destroy();
      res.status(504).json({ error: 'Comedy Cellar API timeout' });
      resolve();
    });

    proxy.on('error', e => {
      res.status(502).json({ error: e.message });
      resolve();
    });

    proxy.write(body);
    proxy.end();
  });
};

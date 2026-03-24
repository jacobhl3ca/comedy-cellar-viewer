const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });

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
        res.status(200).json(JSON.parse(data));
        resolve();
      });
    });

    proxy.on('error', e => {
      res.status(502).json({ error: e.message });
      resolve();
    });

    proxy.write(body);
    proxy.end();
  });
};

const https = require('https');

// Batch endpoint: fetches multiple days in one serverless invocation
// GET /api/lineup-batch?days=7  (default 7, max 14)
// Returns { results: { "2026-03-27": { show: { html: "..." } }, ... } }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache for 5 minutes — one edge-cached response covers all days
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 14);

  // Generate date strings
  const dates = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // Fetch all days in parallel from Comedy Cellar
  const results = {};
  await Promise.all(dates.map(async (dateStr) => {
    try {
      const data = await fetchCellarDay(dateStr);
      results[dateStr] = data;
    } catch (e) {
      results[dateStr] = { error: e.message };
    }
  }));

  res.status(200).json({ results, dates, count: dates.length });
};

function fetchCellarDay(dateStr) {
  const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({
    date: dateStr, venue: 'newyork', type: 'lineup'
  }))}`;

  return new Promise((resolve, reject) => {
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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Comedy Cellar')); }
      });
    });

    proxy.setTimeout(12000, () => {
      proxy.destroy();
      reject(new Error('Comedy Cellar API timeout'));
    });

    proxy.on('error', reject);
    proxy.write(body);
    proxy.end();
  });
}

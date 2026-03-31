const https = require('https');

// GET /api/availability?days=7
// Returns sold-out status for Comedy Cellar shows by scraping the reservation API.
// Step 1: Load reservation page to get cca auth token
// Step 2: Call /reservations/api/getShows for each date
// Returns { results: { "2026-03-31": { shows: [{ time, description, soldout, totalGuests, max, cover }] } } }

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ...options.headers
      },
      timeout: 12000
    };
    const req = https.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getCcaToken() {
  const resp = await fetch('https://www.comedycellar.com/reservations-newyork/');
  const match = resp.data.match(/ccgrfConfig\s*=\s*(\{.*?\});/s);
  if (!match) throw new Error('Could not extract cca token');
  const config = JSON.parse(match[1]);
  return { cca: config.cca, created: config.created };
}

async function getShowsForDate(dateStr, cca, created) {
  const resp = await fetch('https://www.comedycellar.com/reservations/api/getShows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Code-Localize': cca,
      'X-Page-Creation': String(created)
    },
    body: JSON.stringify({ date: dateStr })
  });
  const data = JSON.parse(resp.data);
  if (!data?.data?.showInfo?.shows) return [];
  return data.data.showInfo.shows.map(s => ({
    time: s.time,
    description: s.description,
    soldout: s.soldout || (s.max - s.totalGuests < 1),
    almostSoldOut: !s.soldout && (s.max - s.totalGuests > 0) && (s.max - s.totalGuests <= s.venueMax),
    seatsLeft: Math.max(0, s.max - s.totalGuests),
    max: s.max,
    totalGuests: s.totalGuests,
    cover: s.cover,
    timestamp: s.timestamp
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 14);
    const { cca, created } = await getCcaToken();

    const dates = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const results = {};
    await Promise.all(dates.map(async dateStr => {
      try {
        results[dateStr] = { shows: await getShowsForDate(dateStr, cca, created) };
      } catch (e) {
        results[dateStr] = { shows: [], error: e.message };
      }
    }));

    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const { scrapeGotham, scrapeStandupNY, scrapeTheStand, scrapeNYCC, scrapeUnionHall } = require('../lib/club-scrapers');

// One serverless function for every scraped club, dispatched by ?venue=.
// Replaces the separate api/gotham.js, api/nycc.js, api/the-stand.js and
// api/standupny.js so that adding venues no longer adds functions (Vercel Hobby
// caps a deployment at 12). Each venue keeps the same { shows, count, source }
// response shape the frontend already expects.
const VENUES = {
  gotham:      { fn: scrapeGotham,    source: 'gothamcomedyclub.com' },
  nycc:        { fn: scrapeNYCC,      source: 'newyorkcomedyclub.com/calendar' },
  'the-stand': { fn: scrapeTheStand,  source: 'thestandnyc.com' },
  standupny:   { fn: scrapeStandupNY, source: 'standupny.com' },
  'union-hall': { fn: scrapeUnionHall, source: 'unionhallny.com (Eventbrite)' },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const venue = String(req.query.venue || '').toLowerCase();
  const entry = VENUES[venue];
  if (!entry) {
    return res.status(400).json({ error: 'Provide ?venue=<id>', valid: Object.keys(VENUES) });
  }

  try {
    const shows = await entry.fn();
    res.status(200).json({ shows, count: shows.length, source: entry.source });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

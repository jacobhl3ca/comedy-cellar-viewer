const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const data = await fetchJSON('https://api-cache.squadup.com/api/v3/events?page_size=600&user_ids=9987142&include=price_tiers');
    const events = (data.data || [])
      .filter(evt => evt.attributes && new Date(evt.attributes.start_date) >= new Date())
      .map(evt => {
        const attr = evt.attributes;
        const dt = new Date(attr.start_date);
        const date = dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
        // Extract comedian names from title (e.g. "Jim Gaffigan Live" -> "Jim Gaffigan")
        const title = (attr.name || '').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '');
        // Get price from price_tiers
        const tiers = evt.relationships?.price_tiers?.data || [];
        const prices = tiers.map(t => {
          const included = data.included?.find(i => i.id === t.id && i.type === 'price_tiers');
          return included?.attributes?.price || null;
        }).filter(Boolean);
        const minPrice = prices.length > 0 ? Math.min(...prices) : null;

        return {
          title,
          date,
          time,
          venue: 'Gotham Comedy Club',
          price: minPrice,
          url: `https://gothamcomedyclub.com/events?e=${evt.id}`,
          description: (attr.description || '').replace(/<[^>]+>/g, '').substring(0, 200),
          image: attr.image_thumbnail || attr.image || ''
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    res.status(200).json({ shows: events, count: events.length, source: 'gothamcomedyclub.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://gothamcomedyclub.com/',
        'Origin': 'https://gothamcomedyclub.com'
      }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from SquadUp')); }
      });
    }).on('error', reject);
  });
}

const https = require('https');

const SEATGEEK_CLIENT_ID = 'MTA3MDA0Nzh8MTc3NDMxMTgyMy45ODI2NDY3';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = `https://api.seatgeek.com/2/events?client_id=${SEATGEEK_CLIENT_ID}&venue.city=New+York&taxonomies.name=comedy&per_page=50&sort=datetime_local.asc`;
    const data = await fetchJSON(url);

    const events = (data.events || []).map(evt => {
      const dt = new Date(evt.datetime_local);
      return {
        title: evt.short_title || evt.title,
        date: evt.datetime_local?.split('T')[0] || '',
        time: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        venue: evt.venue?.name || '',
        performers: (evt.performers || []).map(p => p.name).join(', '),
        performerImages: (evt.performers || []).reduce((acc, p) => {
          // Skip SeatGeek generic/placeholder images (cartoon comedian, parking sign, etc.)
          const attr = (p.image_attribution || '').toLowerCase();
          if (p.image && !p.image.includes('/generic-comedy') && !attr.startsWith('seatgeek')) acc[p.name] = p.image;
          return acc;
        }, {}),
        price: evt.stats?.lowest_price || null,
        url: evt.url || '',
        id: evt.id,
        source: 'seatgeek'
      };
    });

    res.status(200).json({ events, count: events.length, source: 'seatgeek.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'CellarTonight/1.0' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from SeatGeek')); }
      });
    });
    request.setTimeout(12000, () => { request.destroy(); reject(new Error('SeatGeek timeout')); });
    request.on('error', reject);
  });
}

const https = require('https');

const TM_API_KEY = process.env.TM_API_KEY || 'ngUmt60hJ6lHzJxzy9ximMn0HtAts4Cj';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&classificationName=comedy&subGenreId=KZazBEonSMnZfZ7vF17&city=New+York&stateCode=NY&size=50&sort=date,asc`;
    const data = await fetchJSON(url);

    const events = (data._embedded?.events || []).map(evt => {
      const startDate = evt.dates?.start?.localDate || '';
      const startTime = evt.dates?.start?.localTime || '';
      const dt = startTime ? new Date(`${startDate}T${startTime}`) : null;
      const venue = evt._embedded?.venues?.[0];

      // Get best performer image (prefer 16_9 ratio, large width)
      const performerImages = {};
      (evt._embedded?.attractions || []).forEach(a => {
        const imgs = a.images || [];
        const best = imgs.filter(i => i.ratio === '16_9').sort((a, b) => (b.width || 0) - (a.width || 0))[0]
          || imgs.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (best?.url) performerImages[a.name] = best.url;
      });

      // Ticketmaster status: "onsale", "offsale", "cancelled", "rescheduled", "postponed"
      const statusCode = evt.dates?.status?.code || '';
      const soldout = statusCode === 'offsale' || statusCode === 'cancelled';

      return {
        title: evt.name || '',
        date: startDate,
        time: dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
        venue: venue?.name || '',
        performers: (evt._embedded?.attractions || []).map(a => a.name).join(', '),
        performerImages,
        price: evt.priceRanges?.[0]?.min || null,
        url: evt.url || '',
        id: evt.id,
        source: 'ticketmaster',
        soldout
      };
    });

    res.status(200).json({ events, count: events.length, source: 'ticketmaster.com' });
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
        catch (e) { reject(new Error('Invalid JSON from Ticketmaster')); }
      });
    });
    request.setTimeout(12000, () => { request.destroy(); reject(new Error('Ticketmaster timeout')); });
    request.on('error', reject);
  });
}

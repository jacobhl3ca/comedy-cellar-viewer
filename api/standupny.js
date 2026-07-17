const https = require('https');

// Stand Up NY (Upper West Side).
// Their site sells tickets through VenuePilot; the public VenuePilot GraphQL API
// (www.venuepilot.co/graphql) exposes the schedule cleanly for account 2535 — no
// scraping of rendered HTML needed. Events link back to the VenuePilot widget that
// lives on standupny.com's homepage via hash routing (#/events/<id>).
const VP_GRAPHQL = 'https://www.venuepilot.co/graphql';
const ACCOUNT_ID = 2535;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const todayNY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const data = await fetchEvents(ACCOUNT_ID, todayNY);
    const collection = data?.data?.paginatedEvents?.collection || [];
    const shows = collection
      .filter(e => e.date && e.date >= todayNY)
      .map(e => ({
        title: decode(e.name),
        date: e.date,
        time: formatTime(e.startTime),
        venue: 'Stand Up NY',
        price: null,
        url: `https://standupny.com/#/events/${e.id}`,
        description: '',
        image: Array.isArray(e.images) ? (e.images[0] || '') : '',
        soldOut: /sold\s*out/i.test(e.status || ''),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || parseTime(a.time) - parseTime(b.time));

    res.status(200).json({ shows, count: shows.length, source: 'standupny.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

function decode(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#8217;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "20:30:00" -> "8:30 PM"
function formatTime(t) {
  const m = (t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

// "8:30 PM" -> minutes since midnight, for stable intra-day sorting.
function parseTime(t) {
  const m = (t || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function fetchEvents(accountId, startDate) {
  const query = `{ paginatedEvents(arguments:{accountIds:[${accountId}], startDate:"${startDate}", limit:200}){ collection { id name date startTime status images } } }`;
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const request = https.request(VP_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://standupny.com',
        'Referer': 'https://standupny.com/',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from VenuePilot')); }
      });
    });
    request.setTimeout(12000, () => { request.destroy(); reject(new Error('VenuePilot timeout')); });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

const https = require('https');

// Gotham Comedy Club schedule.
// Previously read the SquadUp API (api-cache.squadup.com); that host now sits
// behind a Cloudflare managed challenge and returns 403 to servers, so we scrape
// the server-rendered schedule on gothamcomedyclub.com instead. The site prints a
// clean `.gsc-schedule-row` block per show (date / time / title / ticket link),
// which is far more stable than the blocked JSON API.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const html = await fetchText('https://gothamcomedyclub.com/');
    const events = parseSchedule(html);
    res.status(200).json({ shows: events, count: events.length, source: 'gothamcomedyclub.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function decode(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSchedule(html) {
  const blocks = html.split('<div class="gsc-schedule-row">').slice(1);
  // Today in NY (YYYY-MM-DD) to drop anything stale.
  const todayNY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const events = [];
  for (const block of blocks) {
    const dayM = block.match(/gsc-schedule-date day">(\d+)</);
    const monM = block.match(/month-year">\s*<div class="gsc-schedule-date">(\w+)<\/div>\s*<div class="gsc-schedule-date">(\d+)<\/div>/);
    const titleM = block.match(/gsc-schedule-title"><a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!dayM || !monM || !titleM) continue;

    const month = MONTHS[monM[1]];
    if (!month) continue;
    const date = `${monM[2]}-${String(month).padStart(2, '0')}-${String(dayM[1]).padStart(2, '0')}`;
    if (date < todayNY) continue;

    const timeM = block.match(/gsc-schedule-time">([^<]+)</);
    const imgM = block.match(/gsc-schedule-thumb">\s*<img[^>]+src="([^"]+)"/);
    let image = imgM ? imgM[1] : '';
    if (image.startsWith('//')) image = 'https:' + image;

    events.push({
      title: decode(titleM[2]),
      date,
      time: timeM ? timeM[1].trim() : '',
      venue: 'Gotham Comedy Club',
      price: null,
      url: titleM[1],
      description: '',
      image,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || parseTime(a.time) - parseTime(b.time));
  return events;
}

// "8:30 PM" -> minutes since midnight, for stable intra-day sorting.
function parseTime(t) {
  const m = (t || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (resp) => {
      if (resp.statusCode >= 400) {
        resp.resume();
        return reject(new Error(`Gotham HTTP ${resp.statusCode}`));
      }
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    request.setTimeout(12000, () => { request.destroy(); reject(new Error('Gotham timeout')); });
    request.on('error', reject);
  });
}

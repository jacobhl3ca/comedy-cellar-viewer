const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const html = await fetchPage('https://newyorkcomedyclub.com/shows');
    const shows = parseShows(html);
    res.status(200).json({ shows, count: shows.length, source: 'newyorkcomedyclub.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseShows(html) {
  // NYCC uses JS rendering for most content. Parse what we can from server HTML.
  // Show links are at /shows/SLUG with dates in nearby elements
  const shows = [];
  const seen = new Set();

  // Try to find show cards with title, date, time
  const cardPattern = /href="(\/shows\/[^"]+)"[^>]*>[\s\S]*?<h\d[^>]*>([\s\S]*?)<\/h\d>[\s\S]*?(?:<time[^>]*>([\s\S]*?)<\/time>)?/g;
  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);

    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const dateStr = match[3] ? match[3].replace(/<[^>]+>/g, '').trim() : '';

    if (title) {
      shows.push({
        title,
        date: dateStr,
        time: '',
        comedians: [],
        url: 'https://newyorkcomedyclub.com' + path,
        venue: 'NY Comedy Club',
        room: ''
      });
    }
  }

  // Fallback: just extract show links and titles from the page
  if (shows.length === 0) {
    const linkPattern = /href="(\/shows\/([^"]+))"[^>]*>/g;
    while ((match = linkPattern.exec(html)) !== null) {
      const path = match[1];
      const slug = match[2];
      if (seen.has(path)) continue;
      seen.add(path);
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      shows.push({
        title,
        date: '',
        time: '',
        comedians: [],
        url: 'https://newyorkcomedyclub.com' + path,
        venue: 'NY Comedy Club',
        room: ''
      });
    }
  }

  return shows;
}

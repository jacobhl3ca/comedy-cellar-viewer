const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const html = await fetchPage('https://thestandnyc.com/shows');
    const shows = parseShows(html);
    res.status(200).json({ shows, count: shows.length, source: 'thestandnyc.com' });
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
  // Match show titles with URLs
  const pattern = /<h2 class="showtitle[^"]*"><a href="https:\/\/thestandnyc\.com\/?\/?(\/shows\/show\/\d+\/[^"]*)">(.*?)<\/a><\/h2>/gi;
  const matches = [...html.matchAll(pattern)];
  const seen = new Set();
  const shows = [];

  for (const match of matches) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);

    const url = 'https://thestandnyc.com' + path;
    const title = match[2].trim();

    // Extract date/time from URL slug: 2026-03-23-190000
    const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
    let date = '', time = '';
    if (dateMatch) {
      date = dateMatch[1];
      let hour = parseInt(dateMatch[2]);
      const minute = dateMatch[3];
      const ampm = hour < 12 ? 'AM' : 'PM';
      if (hour > 12) hour -= 12;
      if (hour === 0) hour = 12;
      time = `${hour}:${minute} ${ampm}`;
    }

    // Extract comedian names from title
    let comedians = [];
    const presentsMatch = title.match(/Presents:\s*(.*?)(?:\s*&\s*More!?)?$/i);
    if (presentsMatch) {
      comedians = presentsMatch[1]
        .split(/,\s*/)
        .map(n => n.replace(/&\s*$/, '').trim())
        .filter(n => n && n !== 'More!' && n !== '& More!' && n !== '&');
    } else if (title.includes('& Friends')) {
      const friendsMatch = title.match(/^(.*?)\s*&\s*Friends/i);
      if (friendsMatch) comedians = [friendsMatch[1].trim()];
    }

    shows.push({
      title, date, time, comedians, url,
      venue: 'The Stand NYC',
      room: '' // Could extract from page if needed
    });
  }

  return shows;
}

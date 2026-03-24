const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch multiple pages to get all shows
    const pages = await Promise.all([
      fetchPage('https://thestandnyc.com/shows'),
      fetchPage('https://thestandnyc.com/shows?page=2'),
      fetchPage('https://thestandnyc.com/shows?page=3'),
    ]);
    const allHtml = pages.join('\n');
    const shows = parseShows(allHtml);
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

    // Extract comedian names from title — multiple formats
    let comedians = [];

    // "The Stand Presents: Name1, Name2, Name3, & More!"
    const presentsMatch = title.match(/Presents:\s*(.*?)(?:\s*&\s*More!?)?$/i);
    if (presentsMatch) {
      comedians = presentsMatch[1]
        .split(/,\s*/)
        .map(n => n.replace(/&\s*$/, '').trim())
        .filter(n => n && n !== 'More!' && n !== '& More!' && n !== '&');
    }
    // "Name & Friends"
    else if (title.includes('& Friends')) {
      const friendsMatch = title.match(/^(.*?)\s*&\s*Friends/i);
      if (friendsMatch) comedians = [friendsMatch[1].trim()];
    }
    // "Name1, Name2 & Name3" (no "Presents:")
    else if (title.includes(',') || title.includes(' & ')) {
      comedians = title
        .split(/,\s*|\s+&\s+/)
        .map(n => n.trim())
        .filter(n => n && n.length > 1 && !n.match(/^(The|A|An|Live|Show|Comedy|Night|Free|Open|Mic)$/i));
    }
    // Single headliner name (no special keywords)
    else if (!title.match(/WAHO|FEMBOTS|Laughing|Open Mic|Showcase|Workshop|Comedy Class/i)) {
      // Could be "Robert Kelly: A One Man Show" — extract first name
      const colonMatch = title.match(/^([^:]+)/);
      if (colonMatch) {
        const name = colonMatch[1].trim();
        if (name.includes(' ') && name.length < 40) comedians = [name];
      }
    }

    shows.push({
      title, date, time, comedians, url,
      venue: 'The Stand NYC',
      room: ''
    });
  }

  return shows;
}

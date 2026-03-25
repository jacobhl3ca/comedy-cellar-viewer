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
  // Split by show_row container — keeps poster + title together (avoids off-by-one)
  const blocks = html.split('<div class="row show_row ">');
  const seen = new Set();
  const shows = [];

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    // Extract URL and title from desktop showtitle
    const urlMatch = block.match(/showtitle d-none d-sm-block"><a href="https:\/\/thestandnyc\.com\/?\/?([^"]*)">(.*?)<\/a>/);
    if (!urlMatch) continue;

    const path = urlMatch[1];
    const title = urlMatch[2].trim();

    if (seen.has(path)) continue;
    seen.add(path);

    const url = 'https://thestandnyc.com/' + path;

    // Extract date/time from URL slug
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

    // Extract room from the block
    const roomMatch = block.match(/list-show-room">(.*?)<\/span>/);
    const room = roomMatch ? roomMatch[1].trim() : '';

    // Extract FULL lineup from <small>Name</small> tags in this block
    const nameMatches = [...block.matchAll(/<small>(.*?)<\/small>/g)];
    // Dedupe names (mobile + desktop HTML both have them)
    const comedians = [...new Set(nameMatches
      .map(m => m[1].trim())
      .filter(n => n && n.length > 1 && !n.match(/^\$/) && !/^special\s*guests?$/i.test(n) && !/^more\s*tba$/i.test(n))
    )];

    // Extract price
    const priceMatch = block.match(/\$(\d+\.?\d*)/);
    const price = priceMatch ? priceMatch[1] : '';

    // Extract show poster image (from /images/shows/ path, not comedian headshots)
    const posterMatch = block.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/shows\/[^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : '';

    shows.push({
      title, date, time, comedians, url,
      venue: 'The Stand NYC',
      room,
      price,
      poster
    });
  }

  return shows;
}

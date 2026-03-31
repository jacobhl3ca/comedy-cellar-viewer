const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch all pages — pagination uses /shows/P{offset} (20 per page)
    const offsets = [0, 20, 40, 60, 80, 100, 120, 140, 160];
    const urls = offsets.map(o => o === 0
      ? 'https://thestandnyc.com/shows'
      : `https://thestandnyc.com/shows/P${o}`
    );
    const pages = await Promise.all(urls.map(u => fetchPage(u).catch(() => '')));
    const allHtml = pages.join('\n');
    const shows = parseShows(allHtml);
    res.status(200).json({ shows, count: shows.length, source: 'thestandnyc.com' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    request.setTimeout(12000, () => { request.destroy(); reject(new Error('The Stand timeout')); });
    request.on('error', reject);
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

    // Extract comedian headshot photos from The Stand's comedian images
    const comedianPhotos = {};
    const photoMatches = [...block.matchAll(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"[^>]*>/gi)];
    photoMatches.forEach(m => {
      const imgUrl = m[1];
      // Try to match photo to a comedian name by filename
      const filenameMatch = imgUrl.match(/\/([^/]+)\.(jpg|jpeg|png|webp)$/i);
      if (filenameMatch) {
        const photoName = filenameMatch[1].replace(/_/g, ' ').replace(/-/g, ' ').replace(/\s*\d+$/, '');
        // Find matching comedian
        for (const c of comedians) {
          const cNorm = c.toLowerCase().replace(/[.\-']/g, ' ');
          const pNorm = photoName.toLowerCase();
          if (cNorm === pNorm ||
              pNorm.includes(c.split(' ').pop().toLowerCase()) ||
              c.split(' ')[0].toLowerCase() === pNorm) {
            comedianPhotos[c] = imgUrl;
            break;
          }
        }
      }
    });

    // Extract price
    const priceMatch = block.match(/\$(\d+\.?\d*)/);
    const price = priceMatch ? priceMatch[1] : '';

    // Extract show poster image (from /images/shows/ path, not comedian headshots)
    const posterMatch = block.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/shows\/[^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : '';

    // Detect sold-out: Stand replaces "Buy Tickets" with <span class="btn btn-outline-danger">Sold Out</span>
    const soldout = /btn-outline-danger[^>]*>Sold Out/i.test(block);

    shows.push({
      title, date, time, comedians, url,
      venue: 'The Stand NYC',
      room,
      price,
      poster,
      comedianPhotos,
      soldout
    });
  }

  return shows;
}

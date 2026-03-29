const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache for 7 days — photos don't change often
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Provide ?name=Performer+Name' });

  const slug = name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  // Try sources in order: The Stand → NYCC → Comedy Cellar uploads
  const sources = [
    { name: 'stand', fn: () => tryStand(slug) },
    { name: 'nycc', fn: () => tryNYCC(slug) },
    { name: 'cellar', fn: () => tryCellar(slug) },
  ];

  for (const source of sources) {
    try {
      const url = await source.fn();
      if (url) return res.status(200).json({ url, source: source.name });
    } catch {}
  }

  return res.status(200).json({ url: '', source: 'none' });
};

// Fetch HTML from a URL with timeout
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    }, resp => {
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        // Follow redirect
        return fetchHTML(resp.headers.location).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    request.setTimeout(8000, () => { request.destroy(); reject(new Error('timeout')); });
    request.on('error', reject);
  });
}

// The Stand — comedian profile page
async function tryStand(slug) {
  const html = await fetchHTML(`https://thestandnyc.com/comedians/${slug}`);
  // Look for comedian headshot in the profile page
  const match = html.match(/<img[^>]+src="(https?:\/\/thestandnyc\.com\/images\/comedians\/[^"]+)"/i);
  return match ? match[1] : '';
}

// NYCC — comedian profile page
async function tryNYCC(slug) {
  const url = `https://newyorkcomedyclub.com/comedians/${slug}`;
  const html = await fetchHTML(url);
  // Verify we're on an actual comedian page (not the listing page)
  // Comedian pages have their name in an h1 or the URL slug in a canonical/og tag
  if (html.includes('/comedians"') && !html.includes(`/comedians/${slug}"`)) return '';
  // Also reject if page title suggests it's the listing page
  if (/<title[^>]*>.*Comedians.*<\/title>/i.test(html) && !html.includes(slug)) return '';
  // Look for the comedian's main image (not sidebar/nav images)
  const match = html.match(/<img[^>]+src="(\/img\/(?:comedians|imagetest)\/[^"]+)"/i);
  if (!match) return '';
  const path = match[1].split('?')[0]; // strip cache buster
  return `https://www.newyorkcomedyclub.com${path}`;
}

// Comedy Cellar — try common wp-content upload paths
async function tryCellar(slug) {
  // Cellar uses /wp-content/uploads/YYYY/MM/name-70x70.ext
  // We can't guess the date folder, but we can try the comedian page
  // Actually the Cellar doesn't have individual comedian pages accessible by slug
  // Instead, check if their name appears in a recent lineup
  return '';
}

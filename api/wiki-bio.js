const https = require('https');

// Fetches short bios from Wikipedia for a list of comedian names
// GET /api/wiki-bio?names=Shane+Gillis,Joe+List,Mark+Normand
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const names = (req.query.names || '').split(',').map(n => n.trim()).filter(Boolean).slice(0, 20);
  if (names.length === 0) return res.status(400).json({ error: 'Provide ?names=Name1,Name2' });

  const results = {};
  await Promise.all(names.map(async (name) => {
    try {
      const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`);
      // Reject disambiguation pages ("X may refer to:Y (comedian)...") + show/film/album extracts.
      if (data.type === 'standard' && data.extract && !/\bmay refer to\b/i.test(data.extract)) {
        // Only accept bios about comedians/performers (avoid wrong-person matches)
        const lower = data.extract.toLowerCase();
        const isShowOrAlbum = /\bis an? (american|british|canadian|australian|indian|pakistani|irish)?\s*(tv series|television series|film|movie|album|sitcom|crime drama)\b/i.test(data.extract);
        const isComedian = !isShowOrAlbum && /\b(comedian|comedy|stand-up|comic|actor|actress|television|tv show|podcast|improv|sketch|humor|humour|entertainer|writer.*performer)\b/.test(lower);
        if (isComedian) {
          results[name] = {
            bio: data.extract.substring(0, 300),
            image: data.thumbnail?.source || '',
            url: data.content_urls?.desktop?.page || ''
          };
        }
      }
    } catch (e) {
      // Skip — no Wikipedia entry
    }
  }));

  res.status(200).json({ results, count: Object.keys(results).length });
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'CellarTonight/1.0 (cellartonight.com)' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

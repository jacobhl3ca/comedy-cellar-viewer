const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch this month + next month to cover the 14-day window the rest of the app uses.
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const months = [
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`,
    ];

    const pages = await Promise.all(months.map(m =>
      fetchPage(`https://newyorkcomedyclub.com/calendar/${m}`).catch(() => '')
    ));
    const shows = pages.flatMap(parseCalendar);
    // Sort by date+time and dedupe by url+date+time.
    const seen = new Set();
    const out = shows
      .filter(s => {
        const k = `${s.url}|${s.date}|${s.time}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));

    res.status(200).json({ shows: out, count: out.length, source: 'newyorkcomedyclub.com/calendar' });
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
    request.setTimeout(15000, () => { request.destroy(); reject(new Error('NYCC timeout')); });
    request.on('error', reject);
  });
}

// Decode HTML entities used in data-content (data-content is HTML-encoded HTML).
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Convert "6:15PM" / "11:30PM" to 24h "HH:MM"
function to24h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeStr.trim());
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function parseCalendar(html) {
  if (!html) return [];
  const shows = [];
  // Each day cell: <td ... data-date="YYYY-MM-DD"> ... data-content="<encoded html with event links>"
  const dayPattern = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[\s\S]*?data-content="([^"]+)"/g;
  let m;
  while ((m = dayPattern.exec(html)) !== null) {
    const date = m[1];
    const content = decodeEntities(m[2]);
    // Within content: <a aria-label="..." href="/events/SLUG">Title - 7:00PM</a>
    const evPattern = /<a[^>]+href="(\/events\/[^"]+)"[^>]*>([^<]+?)\s-\s(\d{1,2}:\d{2}\s*[AP]M)<\/a>/gi;
    let em;
    while ((em = evPattern.exec(content)) !== null) {
      const path = em[1];
      const titleRaw = em[2].trim();
      const timeRaw = em[3].trim();
      const time = to24h(timeRaw);
      // Title is usually comedian list ("Name, Name, Name") OR a named show ("ITMATTERS ft: Name, Name").
      const isLineup = !/^[^,]+ ft:?\s|:\s/i.test(titleRaw);
      const comedians = isLineup
        ? titleRaw.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      shows.push({
        title: titleRaw,
        date,
        time,
        comedians,
        url: 'https://newyorkcomedyclub.com' + path,
        venue: 'NY Comedy Club',
        room: ''
      });
    }
  }
  return shows;
}

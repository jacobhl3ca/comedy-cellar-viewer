// Cron job: check upcoming lineups across all venues against alert subscriptions
// and email subscribers only about *newly listed* shows (dedup'd per show per user).
// Runs daily via Vercel cron (vercel.json).

const { Redis } = require('@upstash/redis');

const BASE = 'https://tonightnyc.com';
const NOTIFIED_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days — long enough that a future-dated show won't re-fire before it passes

let redis;
function getKV() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return redis;
}

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchJSON(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
    if (!r.ok) {
      console.error(`[alert-check] ${path} HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`[alert-check] fetch ${path}:`, e.message);
    return null;
  }
}

// Collect every (comedian, date, venue, show) listing from upcoming lineups
// across all venue caches. Each listing has a stable showKey for per-user dedup.
async function collectListings() {
  const [cellar, stand, nycc, big, gotham] = await Promise.all([
    fetchJSON('/data/cellar-cache.json'),
    fetchJSON('/data/stand-cache.json'),
    fetchJSON('/data/nycc-cache.json'),
    fetchJSON('/data/big-shows-cache.json'),
    fetchJSON('/data/gotham-cache.json'),
  ]);

  const today = todayISO();
  const listings = [];

  if (cellar?.results) {
    for (const [dateStr, day] of Object.entries(cellar.results)) {
      if (dateStr < today) continue;
      const html = day?.show?.html || '';
      const names = [...new Set([...html.matchAll(/<span class="name">(.*?)<\/span>/g)].map(m => m[1].trim()))];
      for (const n of names) {
        if (!n) continue;
        listings.push({
          comedian: n,
          dateStr,
          venue: 'Comedy Cellar',
          showTitle: null,
          url: 'https://www.comedycellar.com/lineup/',
          showKey: `cellar:${dateStr}:${normalizeName(n)}`,
        });
      }
    }
  }

  for (const s of (stand?.shows || [])) {
    if (!s.date || s.date < today) continue;
    for (const n of (s.comedians || [])) {
      if (!n) continue;
      listings.push({
        comedian: n,
        dateStr: s.date,
        venue: 'The Stand',
        showTitle: s.title,
        url: s.url,
        showKey: `stand:${s.date}:${s.time || ''}:${normalizeName(n)}`,
      });
    }
  }

  // NYCC: only structured comedians[] — titles are too noisy to parse safely
  for (const s of (nycc?.shows || [])) {
    if (!s.date || s.date < today) continue;
    for (const n of (s.comedians || [])) {
      if (!n) continue;
      listings.push({
        comedian: n,
        dateStr: s.date,
        venue: 'NY Comedy Club',
        showTitle: s.title,
        url: s.url,
        showKey: `nycc:${s.date}:${s.time || ''}:${normalizeName(n)}`,
      });
    }
  }

  for (const e of (big?.events || [])) {
    if (!e.date || e.date < today) continue;
    const names = new Set();
    if (e.performers) e.performers.split(/,\s*/).forEach(n => { const t = n.trim(); if (t) names.add(t); });
    if (e.title) names.add(e.title.trim());
    for (const n of names) {
      if (!n) continue;
      listings.push({
        comedian: n,
        dateStr: e.date,
        venue: e.venue || 'Big Show',
        showTitle: e.title,
        url: e.url,
        showKey: `big:${e.id || (e.date + ':' + (e.time || ''))}:${normalizeName(n)}`,
      });
    }
  }

  // Gotham: title is the act name (mirrors render.js' allComediansSeen handling)
  for (const s of (gotham?.shows || [])) {
    if (!s.date || s.date < today) continue;
    const names = new Set();
    if (s.title) names.add(s.title.trim());
    (s.comedians || []).forEach(n => n && names.add(n));
    for (const n of names) {
      if (!n) continue;
      listings.push({
        comedian: n,
        dateStr: s.date,
        venue: 'Gotham Comedy Club',
        showTitle: s.title,
        url: s.url || 'https://www.gothamcomedyclub.com/',
        showKey: `gotham:${s.date}:${s.time || ''}:${normalizeName(n)}`,
      });
    }
  }

  return listings;
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[alert-check] No RESEND_API_KEY — would email ${to}: ${subject}`);
    return false;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Tonight NYC <alerts@tonightnyc.com>',
        to,
        subject,
        html,
      }),
    });
    if (!resp.ok) console.error(`[alert-check] Resend HTTP ${resp.status}`);
    return resp.ok;
  } catch (e) {
    console.error(`[alert-check] Email send failed:`, e);
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const kv = getKV();
  if (!kv) {
    return res.status(200).json({ message: 'KV not configured, skipping' });
  }

  try {
    const listings = await collectListings();

    const byComedian = new Map();
    for (const l of listings) {
      const k = normalizeName(l.comedian);
      if (!k) continue;
      if (!byComedian.has(k)) byComedian.set(k, []);
      byComedian.get(k).push(l);
    }

    const emails = await kv.smembers('alert_emails');
    if (!emails || emails.length === 0) {
      return res.status(200).json({ message: 'No alert subscriptions', listings: listings.length });
    }

    const dateLabel = (d) =>
      new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    let emailsSent = 0;
    let totalNew = 0;

    for (const email of emails) {
      const alertData = await kv.get(`alert:${email}`);
      if (!alertData || !alertData.comedians?.length) continue;

      const candidates = [];
      for (const target of alertData.comedians) {
        const hits = byComedian.get(normalizeName(target)) || [];
        for (const hit of hits) candidates.push({ ...hit, subscribedName: target });
      }
      if (!candidates.length) continue;

      const newOnes = [];
      for (const c of candidates) {
        const exists = await kv.exists(`notified:${email}:${c.showKey}`);
        if (!exists) newOnes.push(c);
      }
      if (!newOnes.length) continue;
      totalNew += newOnes.length;

      const byDate = {};
      for (const c of newOnes) {
        if (!byDate[c.dateStr]) byDate[c.dateStr] = [];
        byDate[c.dateStr].push(c);
      }
      const sortedDates = Object.keys(byDate).sort();

      const uniqueNames = [...new Set(newOnes.map(c => c.subscribedName))];
      const namesShort = uniqueNames.slice(0, 3).join(', ');
      const moreCount = uniqueNames.length - 3;
      const subject = moreCount > 0
        ? `${namesShort} +${moreCount} more newly booked`
        : `${namesShort} newly booked in NYC`;

      let html = `<div style="font-family:-apple-system,sans-serif;max-width:540px;margin:0 auto;color:#111;">`;
      html += `<h2 style="color:#e63636;margin-bottom:4px;">New listings for your comedians</h2>`;
      html += `<p style="color:#666;font-size:13px;margin-top:0;">Newly added to NYC lineups since your last alert.</p>`;
      for (const d of sortedDates) {
        html += `<h3 style="margin:18px 0 6px;font-size:14px;">${dateLabel(d)}</h3>`;
        html += `<ul style="margin:0;padding-left:18px;">`;
        for (const c of byDate[d]) {
          const showPart = c.showTitle ? ` — ${escapeHtml(c.showTitle)}` : '';
          const venuePart = ` <span style="color:#888;font-size:12px;">@ ${escapeHtml(c.venue)}</span>`;
          const link = c.url ? ` <a href="${escapeHtml(c.url)}" style="color:#e63636;font-size:12px;">tickets →</a>` : '';
          html += `<li style="margin-bottom:4px;"><strong>${escapeHtml(c.subscribedName)}</strong>${showPart}${venuePart}${link}</li>`;
        }
        html += `</ul>`;
      }
      html += `<p style="margin-top:20px;"><a href="https://tonightnyc.com" style="color:#e63636;">Open Tonight NYC →</a></p>`;
      html += `<p style="font-size:11px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">You're getting this because you set alerts on Tonight NYC. You'll only be notified once per show. <a href="https://tonightnyc.com/#alerts" style="color:#888;">Manage alerts</a></p>`;
      html += `</div>`;

      const sent = await sendEmail(email, subject, html);
      if (sent) {
        emailsSent++;
        await Promise.all(
          newOnes.map(c =>
            kv.set(`notified:${email}:${c.showKey}`, 1, { ex: NOTIFIED_TTL_SECONDS })
          )
        );
      }
    }

    return res.status(200).json({
      message: `Checked ${emails.length} subscriptions, ${totalNew} new listings, sent ${emailsSent} emails`,
      listings: listings.length,
    });
  } catch (e) {
    console.error('[alert-check] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};

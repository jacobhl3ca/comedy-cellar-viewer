// Cron job: check today's lineups against alert subscriptions and send emails
// Runs daily via Vercel cron (vercel.json)

const { Redis } = require('@upstash/redis');

let redis;
function getKV() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return redis;
}

const CELLAR_API = 'https://www.comedycellar.com/lineup/api/';

async function fetchLineup(dateStr) {
  const body = `action=cc_get_shows&json=${encodeURIComponent(JSON.stringify({ date: dateStr, venue: 'newyork', type: 'lineup' }))}`;
  const resp = await fetch(CELLAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (!data?.show?.html) return [];
  const names = [...data.show.html.matchAll(/<span class="name">(.*?)<\/span>/g)].map(m => m[1].trim());
  return [...new Set(names)];
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
    return resp.ok;
  } catch (e) {
    console.error(`[alert-check] Email send failed:`, e);
    return false;
  }
}

module.exports = async (req, res) => {
  // Verify cron secret (Vercel sends this automatically)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const kv = getKV();
  if (!kv) {
    return res.status(200).json({ message: 'KV not configured, skipping' });
  }

  try {
    // Fetch next 3 days of lineups
    const dates = [];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const lineupsByDate = {};
    await Promise.all(dates.map(async (dateStr) => {
      lineupsByDate[dateStr] = await fetchLineup(dateStr);
    }));

    // Get all subscribed emails
    const emails = await kv.smembers('alert_emails');
    if (!emails || emails.length === 0) {
      return res.status(200).json({ message: 'No alert subscriptions', dates });
    }

    let emailsSent = 0;
    for (const email of emails) {
      const alertData = await kv.get(`alert:${email}`);
      if (!alertData || !alertData.comedians?.length) continue;

      const matches = {};
      for (const [dateStr, comedians] of Object.entries(lineupsByDate)) {
        const found = alertData.comedians.filter(name =>
          comedians.some(c => c.toLowerCase() === name.toLowerCase())
        );
        if (found.length > 0) matches[dateStr] = found;
      }

      if (Object.keys(matches).length === 0) continue;

      // Build email
      const dateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      let html = `<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">`;
      html += `<h2 style="color: #e63636;">🎤 Your comedians are performing!</h2>`;
      for (const [dateStr, names] of Object.entries(matches)) {
        html += `<p><strong>${dateLabel(dateStr)}</strong>: ${names.join(', ')}</p>`;
      }
      html += `<p style="margin-top: 16px;"><a href="https://tonightnyc.com" style="color: #e63636;">View lineups & reserve →</a></p>`;
      html += `<p style="font-size: 11px; color: #888; margin-top: 24px;">You're getting this because you set up alerts on Tonight NYC. <a href="https://tonightnyc.com#alerts">Manage alerts</a></p>`;
      html += `</div>`;

      const sent = await sendEmail(
        email,
        `🎤 ${Object.values(matches).flat().join(', ')} performing this week`,
        html
      );
      if (sent) emailsSent++;
    }

    return res.status(200).json({
      message: `Checked ${emails.length} subscriptions, sent ${emailsSent} emails`,
      dates,
      lineupCounts: Object.fromEntries(Object.entries(lineupsByDate).map(([k, v]) => [k, v.length])),
    });
  } catch (e) {
    console.error('[alert-check] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};

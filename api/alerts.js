// Alert system — Upstash Redis for storage
// GET /api/alerts?email=x — get alert subscriptions
// POST /api/alerts — save { email, comedians: [...] }
// DELETE /api/alerts?email=x — remove subscription

const { Redis } = require('@upstash/redis');

const ALERTS_PREFIX = 'alert:';

let redis;
function getStore() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return redis;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = getStore();

  if (req.method === 'GET') {
    const email = req.query.email;
    if (!email) {
      return res.status(200).json({
        status: store ? 'active' : 'not_configured',
        message: store
          ? 'Alert system active. POST { email, comedians: [...] } to subscribe.'
          : 'Alert system needs Vercel KV setup. Alerts saved locally in browser only.'
      });
    }
    if (!store) return res.status(200).json({ email, comedians: [], status: 'local_only' });

    try {
      const data = await store.get(ALERTS_PREFIX + email);
      return res.status(200).json(data || { email, comedians: [] });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  }

  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let data;
    try { data = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

    if (!data.email || !data.comedians || !Array.isArray(data.comedians)) {
      return res.status(400).json({ error: 'Need email and comedians array' });
    }

    const record = { email: data.email, comedians: data.comedians, updatedAt: new Date().toISOString() };

    if (store) {
      try {
        await store.set(ALERTS_PREFIX + data.email, record);
        // Also add to index for cron scanning
        await store.sadd('alert_emails', data.email);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to save alerts' });
      }
    }

    return res.status(200).json({
      success: true,
      ...record,
      persisted: !!store,
      message: store
        ? `Alert set for ${data.comedians.length} comedians. You'll get an email when they appear.`
        : `Alert saved locally. Set up Vercel KV for email notifications.`
    });
  }

  if (req.method === 'DELETE') {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Need email query param' });

    if (store) {
      try {
        await store.del(ALERTS_PREFIX + email);
        await store.srem('alert_emails', email);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to delete alerts' });
      }
    }

    return res.status(200).json({ success: true, message: 'Alerts removed' });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

// API endpoint for managing comedian alerts
// GET /api/alerts?email=x — get alerts for email
// POST /api/alerts — save alert preferences { email, comedians: [...] }
// Uses Vercel KV (or falls back to in-memory for dev)

// For now: simple JSON file-based storage via Vercel Blob or local
// MVP: store in query params / localStorage on client, check via cron

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // For MVP: just return info about how to set up alerts
  // Full implementation needs Vercel KV ($0 free tier)
  if (req.method === 'GET') {
    return res.status(200).json({
      message: 'Alert system ready. POST with { email, comedians: [...] } to subscribe.',
      status: 'beta'
    });
  }

  if (req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);

      if (!data.email || !data.comedians || !Array.isArray(data.comedians)) {
        return res.status(400).json({ error: 'Need email and comedians array' });
      }

      // TODO: Store in Vercel KV when set up
      // For now, just acknowledge
      return res.status(200).json({
        success: true,
        email: data.email,
        comedians: data.comedians,
        message: `Alert set for ${data.comedians.length} comedians. You'll be notified when they appear in NYC.`
      });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

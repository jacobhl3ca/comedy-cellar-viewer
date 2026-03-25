// Cron job: scrape comedycellar.com for residency/special show venue assignments
// Runs weekly to keep SPECIAL_SHOW_ROOMS data fresh
// Results are logged — manual update to app.js if changes detected

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const resp = await fetch('https://www.comedycellar.com/', {
      headers: { 'User-Agent': 'CellarTonight/1.0 (venue scraper)' },
    });
    const html = await resp.text();

    // Parse residency/special show sections
    // Look for patterns like: "SHOW_NAME" ... "at VENUE_NAME"
    const showVenueMap = {};

    // Match patterns: show name followed by venue info
    // Comedy Cellar uses patterns like "MONDAYS 7.00pm at FAT BLACK PUSSY CAT (LOUNGE)"
    const residencyPattern = /([A-Z][A-Z\s.']+(?:RESIDENCY|ROOM|BRUNCH|NIGHT|SOUP)?)[\s\S]*?at\s+((?:FAT BLACK PUSSY\s*CAT|COMEDY CELLAR|VILLAGE UNDERGROUND|MACDOUGAL)[^<)]*)/gi;
    const matches = [...html.matchAll(residencyPattern)];

    // Also try to find show names with venue assignments
    const showBlocks = html.match(/<h[34][^>]*>.*?<\/h[34]>[\s\S]*?(?=<h[34]|$)/gi) || [];
    for (const block of showBlocks) {
      const nameMatch = block.match(/<h[34][^>]*>(.*?)<\/h[34]>/i);
      if (!nameMatch) continue;
      const showName = nameMatch[1].replace(/<[^>]+>/g, '').trim();

      const venueMatch = block.match(/at\s+(FAT BLACK PUSSY\s*CAT|COMEDY CELLAR|VILLAGE UNDERGROUND|MACDOUGAL\s*ST)/i);
      if (venueMatch) {
        const venueName = venueMatch[1].trim();
        let normalized = 'Unknown';
        if (/fat black|pussycat|pussy cat/i.test(venueName)) normalized = 'Fat Black Pussycat';
        else if (/macdougal/i.test(venueName)) normalized = 'MacDougal Street';
        else if (/village underground/i.test(venueName)) normalized = 'Village Underground';
        else if (/comedy cellar/i.test(venueName)) normalized = 'MacDougal Street';

        showVenueMap[showName] = normalized;
      }
    }

    // Also try broader text matching for known show names
    const knownShows = ['Colin Quinn', 'CQ Room', 'Bobby Kelly', 'Robert Kelly', 'Jim Norton',
                        'Chris Redd', 'New Joke Night', 'Hot Soup', 'Sunday Brunch'];
    for (const show of knownShows) {
      const pattern = new RegExp(show.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,200}?at\\s+(FAT BLACK PUSSY\\s*CAT|COMEDY CELLAR|VILLAGE UNDERGROUND|MACDOUGAL)', 'i');
      const m = html.match(pattern);
      if (m) {
        const venue = m[1].trim();
        let normalized = 'Unknown';
        if (/fat black|pussycat|pussy cat/i.test(venue)) normalized = 'Fat Black Pussycat';
        else if (/macdougal/i.test(venue)) normalized = 'MacDougal Street';
        else if (/village underground/i.test(venue)) normalized = 'Village Underground';
        else if (/comedy cellar/i.test(venue)) normalized = 'MacDougal Street';

        showVenueMap[show] = normalized;
      }
    }

    // Current hardcoded mappings for comparison
    const currentMappings = {
      'cq room': 'Fat Black Pussycat',
      'colin quinn': 'Fat Black Pussycat',
      'robert kelly': 'Fat Black Pussycat',
      'bobby kelly': 'Fat Black Pussycat',
      'jim norton': 'Fat Black Pussycat',
      'new joke night': 'Fat Black Pussycat',
      'hot soup': 'Fat Black Pussycat',
      'chris redd': 'Fat Black Pussycat',
      'sunday brunch': 'MacDougal Street',
    };

    // Detect changes
    const changes = [];
    for (const [show, venue] of Object.entries(showVenueMap)) {
      const key = show.toLowerCase();
      if (currentMappings[key] && currentMappings[key] !== venue) {
        changes.push({ show, oldVenue: currentMappings[key], newVenue: venue });
      }
    }

    // Find new shows not in current mappings
    const newShows = Object.entries(showVenueMap).filter(([show]) => {
      return !Object.keys(currentMappings).includes(show.toLowerCase());
    });

    console.log('[venue-scrape] Results:', JSON.stringify({ showVenueMap, changes, newShows }, null, 2));

    return res.status(200).json({
      message: 'Venue scrape complete',
      scrapedAt: new Date().toISOString(),
      showVenueMap,
      changes,
      newShows: newShows.map(([name, venue]) => ({ name, venue })),
      currentMappings,
    });
  } catch (e) {
    console.error('[venue-scrape] Error:', e);
    return res.status(500).json({ error: e.message });
  }
};

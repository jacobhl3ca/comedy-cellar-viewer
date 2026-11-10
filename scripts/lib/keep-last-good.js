// Keep the last good show list when a scraper comes back empty.
//
// Each scraper in scripts/prebake.js catches its own errors and returns [], so a
// single 503 used to blank the venue on tonightnyc.com: 2026-11-09 10:50 PM ET,
// Gotham's 503 wrote [] over 107 good shows and the GitHub run stayed green.
//
// Now an empty scrape keeps the old list, minus past dates. The old `prebaked`
// stamp stays on purpose: ~/scripts/tonightnyc-health.py (MAX_AGE 30h) reads it,
// so a venue that keeps failing is still flagged. `keptFrom` marks a kept list.

const fs = require('fs');
const path = require('path');

function todayInNY(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Returns null when the fresh list should be written as-is. Otherwise returns
// { [listKey]: old shows dated today or later, prebaked: old stamp, keptFrom }.
function keepLastGood(prevCache, freshShows, todayNY, listKey = 'shows') {
  if (Array.isArray(freshShows) && freshShows.length) return null;
  const old = prevCache && Array.isArray(prevCache[listKey]) ? prevCache[listKey] : [];
  const future = old.filter(s => s && typeof s.date === 'string' && s.date >= todayNY);
  if (!future.length) return null;
  return {
    [listKey]: future,
    prebaked: prevCache.prebaked,
    keptFrom: prevCache.keptFrom || prevCache.prebaked,
  };
}

// Writes { [listKey], count, source, prebaked[, keptFrom] } to cacheDir/file.
function writeShowCache(cacheDir, file, list, { listKey = 'shows', source, now = new Date(), log = () => {} } = {}) {
  const full = path.join(cacheDir, file);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {}
  const kept = keepLastGood(prev, list, todayInNY(now), listKey);
  const shows = kept ? kept[listKey] : (list || []);
  const out = { [listKey]: shows, count: shows.length, source };
  if (kept) {
    out.prebaked = kept.prebaked;
    out.keptFrom = kept.keptFrom;
  } else {
    out.prebaked = now.toISOString();
  }
  fs.writeFileSync(full, JSON.stringify(out) + '\n');
  if (kept) log(`Saved ${file}: scrape returned 0, KEPT last good list (${shows.length} ${listKey} from ${kept.keptFrom})`);
  else log(`Saved ${file} (${shows.length} ${listKey})`);
  return { kept: !!kept, count: shows.length };
}

module.exports = { keepLastGood, writeShowCache, todayInNY };

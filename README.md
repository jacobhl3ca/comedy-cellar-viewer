# Tonight NYC — Comedy Cellar Viewer

Web app (and iOS wrapper) for browsing upcoming NYC comedy lineups across multiple venues. Live at **[tonightnyc.com](https://tonightnyc.com)**.

**Venues covered:** Comedy Cellar, The Stand, NY Comedy Club, Gotham Comedy Club, and big-ticket shows via SeatGeek/Ticketmaster.

**Features:** Per-show comedian breakdowns, fave/skip ratings, sold-out detection, email alerts, and a sharable preferences link.

## Project structure

```
src/          JS source files (concatenated + minified → public/app.min.js)
api/          Vercel serverless functions (lineup proxy, venue scrapers, alerts)
  cron/       Scheduled jobs (daily alert checks, weekly venue scraping)
scripts/      Build-time scripts (data baking, photo download, bio filling)
public/       Static output served to the browser
  data/       Prebaked JSON caches (updated by build/cron scripts)
  photos/     Comedian headshots
ios/          Capacitor iOS wrapper
```

## Local development

```bash
npm install

# Full dev server with live Vercel Functions (requires Vercel CLI + env vars):
npm run dev:vercel

# Static-only preview (API calls require env vars to work):
npm run build && npx serve public -p 3000
```

## Building

```bash
npm run build
```

Concatenates `src/jazz.js → native.js → prefs.js → data.js → render.js → ui.js → init.js` into `public/app.js`, minifies via Terser + CleanCSS, then updates the cache-bust hash in `public/index.html`.

## Environment variables

| Variable | File | Purpose |
|----------|------|---------|
| `SEATGEEK_CLIENT_ID` | `api/big-shows.js` | Comedy events from SeatGeek |
| `TM_API_KEY` | `api/photo-lookup.js` | Ticketmaster photo search |
| `KV_REST_API_URL` | `api/alerts.js`, `api/cron/check-alerts.js` | Upstash Redis for email alerts |
| `KV_REST_API_TOKEN` | same | Upstash Redis auth token |
| `CRON_SECRET` | `api/cron/scrape-venues.js` | Secures the weekly venue-scrape endpoint |
| `RESEND_API_KEY` | `api/cron/check-alerts.js` | Resend for outbound alert emails |

## Deployment

Deployed to Vercel. `public/` is the static output directory; `api/` contains serverless functions deployed automatically. Cron schedules are defined in `vercel.json`:

- **Daily at 14:00 UTC** — `api/cron/check-alerts.js` checks upcoming lineups and emails subscribers whose watched comedians are newly listed.
- **Mondays at 06:00 UTC** — `api/cron/scrape-venues.js` scrapes Comedy Cellar for residency/venue changes.

## iOS app

The iOS wrapper uses [Capacitor](https://capacitorjs.com/) (`capacitor.config.json`). Source lives in `ios/`. The web app detects `window.Capacitor` and adjusts theme handling and haptics accordingly.

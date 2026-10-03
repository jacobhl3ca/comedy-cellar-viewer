# Tonight NYC — Comedy Cellar Viewer

Web app, with iOS and Android wrappers, for browsing upcoming NYC comedy lineups across multiple venues.

**[tonightnyc.com](https://tonightnyc.com)** · [iOS](https://apps.apple.com/app/id6763027650) · [Android](https://play.google.com/store/apps/details?id=com.jacobhl.tonightnyc)

**Venues covered:** Comedy Cellar, The Stand, NY Comedy Club, Gotham Comedy Club, Stand Up NY, Union Hall, and big-ticket shows via SeatGeek/Ticketmaster.

**Features:** Per-show comedian breakdowns, fave/skip ratings, sold-out detection, email alerts, and a sharable preferences link.

## Project structure

```
src/          JS source files (concatenated + minified → public/app.min.js)
api/          Vercel serverless functions (lineup proxy, venue scrapers, alerts)
  cron/       Cron handlers (daily alert check; venue scrape, unscheduled)
scripts/      Build and prebake scripts (data baking, photo download, bio filling)
public/       Static output served to the browser
  data/       Prebaked JSON caches (refreshed by the Nightly Prebake workflow)
  photos/     Comedian headshots
ios/          Capacitor iOS wrapper
android/      Capacitor Android wrapper
.github/      Nightly Prebake + Lighthouse workflows
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

Concatenates `src/jazz.js → native.js → prefs.js → data.js → render.js → ui.js → init.js → account.js` into `public/app.js`, minifies via Terser + CleanCSS, then updates the cache-bust hash in `public/index.html`.

## Environment variables

| Variable | File | Purpose |
|----------|------|---------|
| `SEATGEEK_CLIENT_ID` | `api/big-shows.js` | Comedy events from SeatGeek |
| `TM_API_KEY` | `api/photo-lookup.js` | Ticketmaster photo search |
| `KV_REST_API_URL` | `api/alerts.js`, `api/cron/check-alerts.js` | Upstash Redis for email alerts |
| `KV_REST_API_TOKEN` | same | Upstash Redis auth token |
| `CRON_SECRET` | `api/cron/check-alerts.js`, `api/cron/scrape-venues.js` | Secures the cron endpoints |
| `RESEND_API_KEY` | `api/cron/check-alerts.js` | Resend for outbound alert emails |

## Deployment

Deployed to Vercel. `public/` is the static output directory; `api/` contains serverless functions deployed automatically.

- **Nightly Prebake** (GitHub Actions, `.github/workflows/prebake.yml`) — runs at 3 am and 6 pm ET. `scripts/prebake.js` pulls every venue's lineups, downloads new headshots, fills missing bios, and commits the refreshed `public/data/` + `public/photos/`. That push redeploys the site, so pages load from static JSON with no function calls at runtime.
- **Daily at 14:00 UTC** (Vercel cron, `vercel.json`) — `api/cron/check-alerts.js` checks upcoming lineups and emails subscribers whose watched comedians are newly listed.
- `api/cron/scrape-venues.js` (Comedy Cellar residency/venue changes) is kept but not on a schedule.

## iOS and Android apps

Both wrappers use [Capacitor](https://capacitorjs.com/) (`capacitor.config.json`, app id `com.jacobhl.tonightnyc`). Source lives in `ios/` and `android/`. Neither is part of the Vercel deploy (see `.vercelignore`). The web app detects `window.Capacitor` and adjusts theme handling and haptics accordingly.

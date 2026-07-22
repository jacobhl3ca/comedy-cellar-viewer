# Tonight NYC / Cellar Tonight

## Facts

- Live app: `https://tonightnyc.com`.
- This repo is the comedy-lineup viewer plus the merged jazz mode; standalone `~/Tonight Jazz/tonight-jazz-viewer` is an archive.
- `src/` files are concatenated into `public/app.js`, then minified to `public/app.min.js`.
- `api/` contains Vercel serverless functions and cron handlers; `public/` is the browser output.
- Capacitor iOS wrapper lives in `ios/`.

## Workflow

- Before changes, read `README.md`, `BACKLOG.md`, and any touched `api/`, `src/`, or `scripts/` files.
- Run `npm run build` after frontend/source changes; it also bakes jazz data, concatenates source files, minifies JS/CSS, and cache-busts `public/index.html`.
- Use `npm run dev:vercel` when API behavior must be exercised locally; static preview is `npm run dev`.
- Keep concat order intact unless deliberately changing the boot pipeline: `jazz.js`, `native.js`, `prefs.js`, `data.js`, `render.js`, `ui.js`, `init.js`.

## Guardrails

- Do not commit or print env vars for SeatGeek, Ticketmaster, Upstash, Resend, or cron secrets.
- Do not split or reorder source files casually; previous bugs came from concat-order assumptions.
- Do not revive the standalone Tonight Jazz repo for live work unless Jacob explicitly asks.

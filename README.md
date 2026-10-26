# sgairquality.com

Live Singapore haze tracker: 24-hr PSI, PM2.5, NEA forecast, fire hotspots and regional haze news.
A static site with no server, no database and no npm dependencies (Node 20+).

## How it works

A GitHub Actions job (`.github/workflows/update.yml`) runs every 30 minutes:

1. `scripts/update.mjs` fetches the latest NEA readings, haze advisory, hotspots, weather and headlines into `data/live.json`
2. `scripts/daily.mjs` adds each day's peak PSI and PM2.5 to `data/daily.json` (this year vs last year, one NEA call per day)
3. `scripts/build.mjs` renders the pages into `dist/` and deploys them to GitHub Pages

Visitors' browsers read `/data/live.json`, not NEA, so traffic adds no load to government APIs. The browser only calls data.gov.sg directly if that file is more than 90 minutes old.

`data/updates.json` holds the hand-written background and key events.

## Run locally

```sh
node scripts/update.mjs && node scripts/daily.mjs && node scripts/build.mjs
python3 -m http.server -d dist 8000
```

## Data sources

NEA / data.gov.sg (PSI, PM2.5, weather), haze.gov.sg (advisory, hotspots), Open-Meteo CAMS (3-day estimate, free for non-commercial use), Google News RSS (headline titles and links only).

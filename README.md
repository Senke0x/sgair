# sgairquality.com

Static haze tracker for Singapore. No server, no database, no npm install.

## How the data stays fresh (every 30 minutes)

| What | How often | How |
|---|---|---|
| 24-hr PSI, 1-hr PM2.5 and the last 24 hours by region | every 30 min | `scripts/update.mjs` → `data/live.json` (2 NEA calls per run: today's PSI and PM2.5; earlier rows are reused) |
| NEA 24-hr PSI forecast, wind and situation update | every 30 min | same |
| NEA fire hotspots and smoke haze areas (map) | every 30 min | same, from the KML files on haze.gov.sg |
| SG / Indonesia / Malaysia headlines | every 30 min | same, from Google News RSS (title, publisher, time, link) |
| 3-day PSI estimate | every 30 min while the page is open | browser calls Open-Meteo (CAMS model), scaled to NEA's latest reading |
| Readings and charts baked into the HTML (SEO) | every 30 min | `scripts/build.mjs` + `assets/charts.js` |
| Daily hotspot totals | daily | `data/history.json`, committed by the workflow |
| Daily peak PSI and PM2.5, past year and the year before (this year vs last year) | daily | `scripts/daily.mjs` → `data/daily.json`: one NEA call per day, each day fetched once. Missing days are filled at most 12 per run (latest month first), then 1 call a day |
| Background and "Key events" summaries | by hand | `data/updates.json` |

Visitors' browsers do not call data.gov.sg: they read `/data/live.json`, so NEA's load stays the same however many people visit. Only if that copy is more than 90 minutes old does the page ask data.gov.sg for the latest reading.

GitHub Actions (`.github/workflows/update.yml`) runs `update.mjs` → `build.mjs` → deploys `dist/` to GitHub Pages at :07 and :37 past each hour. Open tabs also re-read `data/live.json` every 30 minutes (`assets/live.js`), so nobody has to reload.

GitHub may start scheduled jobs a few minutes late at busy times. The live PSI numbers don't depend on it, because they come straight from NEA in the browser.

## Deploy

1. Create a **public** GitHub repo and push this folder (Actions minutes are free for public repos).
2. Repo Settings → Pages → Source: **GitHub Actions**.
3. Actions tab → "Refresh data and deploy" → Run workflow (the first run deploys the site).
4. Settings → Pages → Custom domain: `sgairquality.com`, tick Enforce HTTPS.
5. DNS at your registrar:
   - `A` records for `@`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - `CNAME` for `www` → `<your-github-username>.github.io`
6. Google Search Console + Bing Webmaster Tools: verify the domain, submit `https://sgairquality.com/sitemap.xml`.

## Google Maps key

The key lives in `scripts/build.mjs` (`GMAPS_KEY`, or set a `GMAPS_KEY` env var). It is a browser key, so it is visible in the page by design. Protect it in Google Cloud Console:

- API restrictions: Maps JavaScript API only
- Website restrictions, add all of:
  - `https://sgairquality.com/*`
  - `https://www.sgairquality.com/*`
- Set a daily quota cap and a billing budget alert. The map script only loads when a visitor scrolls to the map.

## Notes

- data.gov.sg rate-limits unauthenticated calls per IP. The workflow makes about 3 calls per run (PSI, PM2.5, weather) plus one a day for `daily.json`. Never put a data.gov.sg API key in browser code.
- Open-Meteo is free for non-commercial use. Buy a plan if the site carries ads.
- Headlines show only the publisher's title and a link. Write any summaries in `updates.json` in your own words.

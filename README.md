# sgairquality.com

Static haze tracker for Singapore. No server, no database, no npm install.

## How the data stays fresh (every 30 minutes)

| What | How often | How |
|---|---|---|
| 24-hr PSI, 1-hr PM2.5, wind, PSI trend | every 30 min while the page is open | browser calls NEA's data.gov.sg API directly (`assets/app.js`) |
| 3-day PSI estimate | every 30 min | browser calls Open-Meteo (CAMS model), scaled to NEA's latest reading |
| NEA 24-hr PSI forecast and situation update | every 30 min | `scripts/update.mjs` → `data/live.json` |
| NEA fire hotspots and smoke haze areas (map) | every 30 min | same, from the KML files on haze.gov.sg |
| SG / Indonesia / Malaysia headlines | every 30 min | same, from Google News RSS (title, publisher, time, link) |
| PSI snapshot baked into the HTML (SEO) | every 30 min | `scripts/build.mjs` |
| Daily peak PSI and hotspot totals | daily | `data/history.json`, committed by the workflow |
| Background and "Key events" summaries | by hand (or a daily Claude task) | `data/updates.json` |

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

- data.gov.sg rate-limits unauthenticated calls per IP. Visitors call from their own browsers, about 5 requests per 30 min; the workflow makes about 3 per run. Never put a data.gov.sg API key in browser code.
- Open-Meteo is free for non-commercial use. Buy a plan if the site carries ads.
- Headlines show only the publisher's title and a link. Write any summaries in `updates.json` in your own words.

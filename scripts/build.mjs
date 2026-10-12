#!/usr/bin/env node
// Builds sgairquality.com into dist/ from:
//   data/live.json     auto, every 30 min (scripts/update.mjs)
//   data/history.json  auto, daily
//   data/updates.json  curated background + key events
// No dependencies. Run: node scripts/build.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SITE = "https://sgairquality.com";
const NAME = "SG Air Quality";
// Browser key for the Maps JavaScript API. It is public by design; it is locked to
// sgairquality.com by HTTP-referrer restrictions in Google Cloud Console.
const GMAPS_KEY = process.env.GMAPS_KEY || "REMOVED_GOOGLE_MAPS_KEY";
const ACTIONBOOK = "https://singapore-haze-air-quality-ndbd1pzo.actionbook.page/";
const CLAUDE = "https://claude.ai/";

const readJSON = (p, fb) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : fb);
const curated = readJSON("data/updates.json", { background: [], news: [] });
const live = readJSON("data/live.json", {});
const history = readJSON("data/history.json", { psi: [], hotspots: [] });
const GENERATED = live.generatedAt || new Date().toISOString();
const VER = GENERATED.replace(/\D/g, "").slice(0, 12);

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return day ? `${day} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}
function sgt(iso) {
  // any ISO timestamp -> parts in Singapore time
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return { date: d.toISOString().slice(0, 10), time: `${((hh + 11) % 12) + 1}${mm ? ":" + String(mm).padStart(2, "0") : ""}${hh < 12 ? "am" : "pm"}` };
}
const fmtDT = (iso) => { const s = sgt(iso); return `${fmtDate(s.date).replace(/ \d{4}$/, "")}, ${s.time}`; };
const num = (n) => Number(n).toLocaleString("en-SG");
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const REGIONS = ["north", "west", "central", "east", "south"];
const RNAME = { north: "North", south: "South", east: "East", west: "West", central: "Central" };
const BANDS = [
  { key: "good", max: 50, label: "Good" },
  { key: "moderate", max: 100, label: "Moderate" },
  { key: "unhealthy", max: 200, label: "Unhealthy" },
  { key: "very", max: 300, label: "Very unhealthy" },
  { key: "hazardous", max: Infinity, label: "Hazardous" },
];
const bandOf = (v) => BANDS.find((b) => v <= b.max);
const pmBand = (v) => (v <= 55 ? "Band I Normal" : v <= 150 ? "Band II Elevated" : v <= 250 ? "Band III High" : "Band IV Very high");
const ADVICE = {
  good: "Air quality is good. Carry on with normal activities.",
  moderate: "Air quality is moderate. Normal activities are fine for everyone.",
  unhealthy: "Healthy people should cut down on long or strenuous outdoor activity. Children, the elderly and pregnant women should keep it to a minimum, and people with heart or lung conditions should avoid it.",
  very: "Everyone should avoid long or strenuous outdoor activity. Children, the elderly and pregnant women should stay indoors as much as possible, and people with heart or lung conditions should avoid going outdoors.",
  hazardous: "Healthy people should keep outdoor activity to a minimum. Children, the elderly, pregnant women and people with heart or lung conditions should avoid going outdoors.",
};

function write(rel, html) {
  const out = join(DIST, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

// ---------- live snapshot ----------
const now = live.now;
const psiVals = now ? REGIONS.map((r) => now.psi[r]).filter((v) => typeof v === "number") : [];
const snap = psiVals.length
  ? { max: Math.max(...psiVals), min: Math.min(...psiVals), band: bandOf(Math.max(...psiVals)), hot: REGIONS.filter((r) => now.psi[r] === Math.max(...psiVals)).map((r) => RNAME[r]) }
  : null;

// ---------- shared pieces ----------
const PAGES = [
  { path: "/", label: "Live PSI" },
  { path: "/singapore-haze-policy/", label: "Singapore measures" },
  { path: "/indonesia-forest-fires/", label: "Indonesia fires" },
  { path: "/malaysia-haze/", label: "Malaysia" },
];

const skyline = `<svg class="skyline" viewBox="0 0 1200 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
<path d="M0 160V118h40v-22h26v22h18V84h30v34h22v-50h12v-12h20v12h12v50h30V96h44v22h20V58h34v60h16V90h28v28h40V40h10V26h18v14h10v78h26v-36h38v36h22V72h20l10-14 10 14h20v46h32V100h30v18h44V66h36v52h18V92h22v26h40V50h14V34h12v16h14v68h26V86h42v32h20V64h30v54h34V96h28v22h36V78h40v40h26V104h36v14h40v42z"/>
</svg>`;

function header(current) {
  return `<header class="site-head">
  <a class="brand" href="/" aria-label="${NAME} home">
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--brand-disc)"/><path d="M6 19c3-2 5-2 8 0s5 2 8 0 4-2 4-2M6 13c3-2 5-2 8 0s5 2 8 0 4-2 4-2" fill="none" stroke="var(--brand-wave)" stroke-width="2.2" stroke-linecap="round"/></svg>
    <span>sgairquality</span>
  </a>
  <nav aria-label="Main">${PAGES.map((p) => `<a href="${p.path}"${p.path === current ? ' aria-current="page"' : ""}>${esc(p.label)}</a>`).join("")}</nav>
</header>`;
}

function footer() {
  return `<footer class="site-foot">
  <div class="foot-grid">
    <div>
      <p class="foot-brand">sgairquality.com</p>
      <p>An independent haze tracker for Singapore. Not affiliated with NEA or any government agency. For official advisories, check <a href="https://www.haze.gov.sg/" rel="noopener">haze.gov.sg</a> or the myENV app.</p>
    </div>
    <div>
      <p class="foot-h">Data</p>
      <p>PSI, PM2.5, weather, hotspots and haze areas from the National Environment Agency via <a href="https://data.gov.sg/" rel="noopener">data.gov.sg</a> and <a href="https://www.haze.gov.sg/" rel="noopener">haze.gov.sg</a> (<a href="https://data.gov.sg/open-data-licence" rel="noopener">Singapore Open Data Licence</a>). Forecast model from <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a> (CAMS). Headlines link to their publishers. Site data last refreshed ${fmtDT(GENERATED)} SGT.</p>
    </div>
    <div>
      <p class="foot-h">Pages</p>
      <ul class="foot-links">${PAGES.map((p) => `<li><a href="${p.path}">${esc(p.label)}</a></li>`).join("")}</ul>
    </div>
  </div>
  <div class="credits">
    <span>Coding by <a href="${CLAUDE}" rel="noopener" target="_blank">Claude</a></span>
    <span>Data collect by <a href="${ACTIONBOOK}" rel="noopener" target="_blank">Actionbook</a></span>
  </div>
</footer>`;
}

function layout({ path, title, description, body, jsonld = [], scripts = "", bodyAttrs = "" }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en-SG">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en-SG" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#2b3a4a">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_SG">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/assets/og.png">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://api-open.data.gov.sg" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css?v=${VER}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body ${bodyAttrs}>
<a class="skip" href="#main">Skip to content</a>
${header(path)}
<main id="main">
${body}
</main>
${footer()}
${scripts}
</body>
</html>
`;
}

// ---------- content blocks ----------
function keyEvents(items, { showRegion = false } = {}) {
  const regionName = { sg: "Singapore", id: "Indonesia", my: "Malaysia", regional: "Region" };
  return `<ol class="timeline">${items
    .map(
      (n) => `<li>
    <time datetime="${n.date}">${fmtDate(n.date)}</time>
    <div>
      <h3>${esc(n.title)}</h3>
      <p>${esc(n.summary)}</p>
      <p class="src">${showRegion ? `<span class="tag">${regionName[n.region]}</span>` : ""}<a href="${esc(n.url)}" rel="noopener" target="_blank">Read on ${esc(n.source)}</a></p>
    </div>
  </li>`
    )
    .join("")}</ol>`;
}

function headlineList(key, limit = 6) {
  const items = (live.headlines && live.headlines[key]) || [];
  if (!items.length) return `<p class="muted">No new headlines in the last three days.</p>`;
  return `<ul class="headlines" data-feed="${key}">${items
    .slice(0, limit)
    .map((h) => `<li><a href="${esc(h.url)}" rel="noopener nofollow" target="_blank">${esc(h.title)}</a><span class="hl-meta">${esc(h.source)}, <time datetime="${h.publishedAt}">${fmtDT(h.publishedAt)}</time></span></li>`)
    .join("")}</ul>`;
}

function outlookBlock() {
  const a = live.advisory;
  if (!a) return `<div class="outlook" id="outlook"><p>See NEA's latest advisory on <a href="https://www.haze.gov.sg/">haze.gov.sg</a>.</p></div>`;
  const b = BANDS.find((x) => x.label.toLowerCase() === (a.forecastBand || "").toLowerCase());
  return `<div class="outlook" id="outlook"${b ? ` data-band="${b.key}"` : ""}>
  <p class="outlook-range">24-hr PSI forecast: ${esc(a.forecastBand || "see NEA")}</p>
  ${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
  <p class="meta">From NEA's haze situation update, ${fmtDT(a.issuedAt)}. <a href="${esc(a.url)}" rel="noopener">Full advisory on haze.gov.sg</a></p>
</div>`;
}

const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function windBlock() {
  const g = live.weather;
  if (!g || !g.wind) return `<h3>Wind for the next 24 hours</h3><p class="muted">Loading the NEA weather forecast…</p>`;
  const dir = String(g.wind.direction || "").toUpperCase();
  const i = DIRS.indexOf(dir);
  const from = i >= 0 ? i * 22.5 : null;
  const southerly = from != null && from >= 101.25 && from <= 258.75;
  const sp = g.wind.speed || {};
  const arrow = from == null ? "" : `<svg class="wind-arrow" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25"/><g transform="rotate(${from + 180} 27 27)"><path d="M27 7l9 16h-6v20h-6V23h-6z"/></g></svg>`;
  return `<h3>Wind for the next 24 hours</h3>
      <div class="wind-row">${arrow}<p><strong>${esc(dir || "Variable")}</strong> winds, ${sp.low ?? "?"}–${sp.high ?? "?"} km/h. ${g.forecast?.text ? `${esc(g.forecast.text)}.` : ""}</p></div>
      <p class="meta">${southerly ? "Winds from the south and south-east can carry smoke from fires in Sumatra and Kalimantan towards Singapore." : from != null ? "Winds from this direction are less likely to bring smoke from the Indonesian fires." : ""} NEA forecast for ${esc(g.validPeriod?.text || "the next 24 hours")}.</p>`;
}

function mapBlock(view = "region") {
  const hs = live.hotspots;
  return `<div class="map-wrap">
  <div class="map-tools" role="group" aria-label="Map view">
    <button type="button" class="map-btn" data-view="region" aria-pressed="${view === "region"}">Fires and smoke</button>
    <button type="button" class="map-btn" data-view="singapore" aria-pressed="${view === "singapore"}">Singapore regions</button>
  </div>
  <div class="map" id="map" data-key="${GMAPS_KEY}" data-view="${view}" role="region" aria-label="Map of fire hotspots and haze around Singapore">
    <p class="map-placeholder muted">The map loads when you scroll here.</p>
  </div>
  <ul class="legend">
    <li><span class="lg lg-hot"></span>Fire hotspot (NEA satellite detection${hs?.asOf ? `, ${fmtDT(hs.asOf)}` : ""})</li>
    <li><span class="lg lg-mod"></span>Moderate smoke haze</li>
    <li><span class="lg lg-den"></span>Dense smoke haze</li>
    <li><span class="lg lg-sg"></span>Singapore 24-hr PSI</li>
  </ul>
</div>`;
}

function hotspotTable() {
  const hs = live.hotspots;
  if (!hs) return "";
  const rows = hs.byRegion.slice(0, 8);
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<table class="bars">
  <caption>NEA satellite hotspots by area${hs.asOf ? `, ${fmtDT(hs.asOf)}` : ""}</caption>
  <thead><tr><th scope="col">Area</th><th scope="col">Hotspots</th></tr></thead>
  <tbody>${rows
    .map((r) => `<tr><th scope="row">${esc(r.name)}</th><td><span class="bar" style="--w:${((r.count / max) * 100).toFixed(1)}%"></span><span class="bar-n">${num(r.count)}</span></td></tr>`)
    .join("")}</tbody>
</table>`;
}

function seasonChart() {
  const d = history.psi || [];
  if (d.length < 3) return "";
  const W = 900, H = 230, L = 36, R = 8, T = 10, B = 30;
  const yMax = Math.max(200, Math.ceil((Math.max(...d.map((x) => x.max)) + 10) / 50) * 50);
  const bw = (W - L - R) / d.length;
  const Y = (v) => T + (1 - v / yMax) * (H - T - B);
  const grid = [];
  for (let v = 0; v <= yMax; v += 50) grid.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`);
  const bars = d
    .map((x, i) => {
      const bx = L + i * bw + 1, h = Y(0) - Y(x.max);
      const lbl = i % 7 === 0 ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${fmtDate(x.date).replace(/ \d{4}$/, "")}</text>` : "";
      return `<rect class="band-${bandOf(x.max).key}" x="${bx.toFixed(1)}" y="${Y(x.max).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${fmtDate(x.date)}: ${x.max}</title></rect>${lbl}`;
    })
    .join("");
  const unhealthy = d.filter((x) => x.max > 100).length;
  const peak = d.reduce((a, b) => (b.max > a.max ? b : a));
  return `<figure class="season">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily peak 24-hour PSI since ${fmtDate(d[0].date)}. Peak ${peak.max} on ${fmtDate(peak.date)}.">
<g class="grid">${grid.join("")}</g><line class="limit" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${bars}
</svg>
<figcaption><strong>${unhealthy} of ${d.length} days</strong> since ${fmtDate(d[0].date)} reached the unhealthy range (above 100) in at least one region. The season peak so far is <strong>${peak.max}</strong> on ${fmtDate(peak.date)}. Each bar is the highest regional 24-hour PSI of the day.</figcaption>
</figure>`;
}

function hotspotTrend() {
  const t = history.hotspots || [];
  if (t.length < 2) return `<p class="meta">A daily hotspot trend appears here once a few days of NEA data have been collected.</p>`;
  const rows = t.slice(-14);
  const max = Math.max(...rows.map((d) => d.total), 1);
  const W = 560, H = 160, pad = 24, bw = (W - pad * 2) / rows.length;
  return `<figure class="trend-fig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily NEA hotspot totals">${rows
    .map((d, i) => {
      const h = ((H - 50) * d.total) / max, x = pad + i * bw + 4, y = H - 24 - h, cx = x + (bw - 8) / 2;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/><text class="v" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}">${d.total}</text><text x="${cx.toFixed(1)}" y="${H - 6}">${fmtDate(d.date).replace(/ \d{4}$/, "")}</text>`;
    })
    .join("")}</svg><figcaption>Daily hotspot totals detected by NEA, updated automatically.</figcaption></figure>`;
}

const crumbs = (name, path) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Live PSI", item: SITE + "/" },
    { "@type": "ListItem", position: 2, name, item: SITE + path },
  ],
});
const article = (headline, description, path) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline,
  description,
  mainEntityOfPage: SITE + path,
  dateModified: GENERATED,
  datePublished: "2026-10-12T09:00:00+08:00",
  image: SITE + "/assets/og.png",
  author: { "@type": "Organization", name: NAME, url: SITE },
  publisher: { "@type": "Organization", name: NAME, logo: { "@type": "ImageObject", url: SITE + "/assets/apple-touch-icon.png" } },
});

// ---------- FAQ ----------
const FAQ = [
  ["What is the PSI in Singapore?", "The Pollutant Standards Index is the air quality index used by Singapore's National Environment Agency. It combines six pollutants: PM2.5, PM10, ozone, carbon monoxide, sulphur dioxide and nitrogen dioxide. Each one gets a sub-index and the PSI is the highest of them. During haze, PM2.5 almost always sets the PSI."],
  ["What PSI level is unhealthy?", "A 24-hour PSI of 0 to 50 is good and 51 to 100 is moderate. 101 to 200 is unhealthy, 201 to 300 is very unhealthy, and anything above 300 is hazardous."],
  ["Should I look at the 24-hour PSI or the 1-hour PM2.5?", "Use the 24-hour PSI and NEA's forecast to plan the next day, and follow the health advice for that band. Use the 1-hour PM2.5 reading to decide on something you are about to do right now, such as a run."],
  ["Is it safe to exercise outdoors during the haze?", "At an unhealthy PSI, healthy adults should cut down on long or strenuous outdoor exercise. Children, the elderly and pregnant women should keep it to a minimum, and people with heart or lung conditions should avoid it. At very unhealthy levels, everyone should avoid strenuous outdoor activity."],
  ["Do I need an N95 mask?", "Not for short exposure such as commuting or walking between buildings, or when you are indoors. An N95 mask helps if you must spend long periods outdoors when the PSI is unhealthy or worse. N95 masks are not designed for young children, and the elderly, pregnant women and people with heart or lung conditions should ask a doctor first."],
  ["When do schools close in Singapore because of haze?", "MOE considers closing schools when the next day's 24-hour PSI forecast is hazardous, above 300. In 2015, MOE primary and secondary schools, special education schools and kindergartens closed for one day. Every MOE classroom now has an air purifier."],
  ["Where does the haze come from?", "Mostly from forest and peatland fires in Indonesia, especially southern and central Sumatra and Kalimantan, many started to clear land. From August to October, south-easterly and southerly winds carry the smoke towards Singapore and Peninsular Malaysia."],
  ["Why is the haze so bad in 2026?", "A very strong El Niño, sometimes called a Godzilla or super El Niño, and a positive Indian Ocean Dipole have made the region hotter and drier, so fires spread faster and burn longer. Forecasters expect the dry spell to end in late October or early November."],
  ["How often does this page update?", "Every 30 minutes. The PSI and PM2.5 readings are pulled straight from NEA in your browser, and the site itself rebuilds every 30 minutes with NEA's latest forecast, satellite hotspots, smoke haze areas and news headlines. NEA publishes new readings every hour."],
  ["How is the haze forecast on this page made?", "It takes hourly PM2.5 forecasts from the CAMS global atmospheric model (via Open-Meteo), scales them to match the latest NEA readings, and converts the result to the PSI scale. It is an estimate, not an official forecast. NEA's daily advisory is the official one."],
];
const faqHtml = `<div class="faq">${FAQ.map(([q, a]) => `<details><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join("")}</div>`;
const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };

const HEALTH_TABLE = `<div class="table-wrap"><table class="health">
<caption>NEA health advice by 24-hour PSI (summarised)</caption>
<thead><tr><th scope="col">24-hour PSI</th><th scope="col">Healthy people</th><th scope="col">Elderly, pregnant women, children</th><th scope="col">People with chronic lung or heart disease</th></tr></thead>
<tbody>
<tr class="b-good"><th scope="row"><span class="dot"></span>0–100 Good to moderate</th><td>Normal activities</td><td>Normal activities</td><td>Normal activities</td></tr>
<tr class="b-unhealthy"><th scope="row"><span class="dot"></span>101–200 Unhealthy</th><td>Reduce long or strenuous outdoor exertion</td><td>Minimise long or strenuous outdoor exertion</td><td>Avoid long or strenuous outdoor exertion</td></tr>
<tr class="b-very"><th scope="row"><span class="dot"></span>201–300 Very unhealthy</th><td>Avoid long or strenuous outdoor exertion</td><td>Minimise outdoor activity</td><td>Avoid outdoor activity</td></tr>
<tr class="b-hazardous"><th scope="row"><span class="dot"></span>Above 300 Hazardous</th><td>Minimise outdoor activity</td><td>Avoid outdoor activity</td><td>Avoid outdoor activity</td></tr>
</tbody></table></div>
<p class="meta">Anyone feeling unwell, especially the elderly, children and people with chronic heart or lung disease, should see a doctor. Full guidance: <a href="https://www.haze.gov.sg/" rel="noopener">haze.gov.sg</a>.</p>`;

const mapScript = `<script src="/assets/map.js?v=${VER}" defer></script>`;

// ---------- Home ----------
function home() {
  const title = "Singapore PSI & Haze Today: Live Air Quality and Forecast";
  const description = "Live 24-hour PSI and PM2.5 for all five regions of Singapore, refreshed every 30 minutes, plus a 3-day haze forecast, fire hotspot map and NEA advisories.";
  const hs = live.hotspots;
  const regionTile = (r) => {
    const v = now?.psi?.[r];
    const b = typeof v === "number" ? bandOf(v) : null;
    const pm = now?.pm25_1h?.[r];
    return `<div class="reg reg-${r}" data-region="${r}"${b ? ` data-band="${b.key}"` : ""}>
        <span class="reg-name">${RNAME[r]}</span>
        <span class="reg-psi">${v ?? "–"}</span>
        <span class="reg-pm">PM2.5 ${pm ?? "–"}</span>
      </div>`;
  };
  const rows = now
    ? REGIONS.slice()
        .sort((a, b) => now.psi[b] - now.psi[a])
        .map((k) => {
          const bb = bandOf(now.psi[k]), p1 = now.pm25_1h?.[k];
          return `<tr><th scope="row">${RNAME[k]}</th><td><span class="pill ${bb.key}">${now.psi[k]}</span> <span class="pm-tag">${bb.label}</span></td><td>${p1 != null ? `${p1}<span class="pm-tag">${pmBand(p1)}</span>` : "–"}</td><td>${now.pm25_24h?.[k] ?? "–"}</td><td>${now.pm10_24h?.[k] ?? "–"}</td><td>${now.o3_8h?.[k] ?? "–"}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">Loading…</td></tr>`;

  const summary = snap
    ? `At ${fmtDT(now.timestamp)}, the 24-hour PSI ranged from ${snap.min} to ${snap.max} across Singapore, in the ${snap.band.label.toLowerCase()} range${live.advisory?.forecastBand ? `, and NEA forecasts it to be ${live.advisory.forecastBand.toLowerCase()} over the next 24 hours` : ""}.${hs ? ` NEA's latest satellite pass found ${num(hs.total)} hotspots in the region, ${num(hs.byRegion.find((r) => r.name === "Kalimantan")?.count || 0)} in Kalimantan and ${num(hs.byRegion.find((r) => r.name === "Sumatra")?.count || 0)} in Sumatra.` : ""}`
    : "";

  const body = `
<section class="hero" id="now" aria-labelledby="h1">
  <div class="sky" aria-hidden="true"><div class="haze-layer"></div>${skyline}</div>
  <div class="hero-inner">
    <div class="hero-main">
      <h1 id="h1">Singapore air quality today</h1>
      <p class="hero-sub">Highest 24-hour PSI across the island right now</p>
      <div class="psi-readout" aria-live="polite">
        <span class="psi-num" id="psi-max">${snap ? snap.max : "–"}</span>
        <span class="psi-band" id="psi-band">${snap ? snap.band.label : "Loading NEA readings"}</span>
      </div>
      <p class="advice" id="psi-advice">${snap ? ADVICE[snap.band.key] : "Readings load from the National Environment Agency every 30 minutes."}</p>
      <p class="stamp"><span class="live" title="Readings update automatically every 30 minutes"><span class="live-dot" aria-hidden="true"></span>Live</span> <span id="psi-time">${snap ? `${snap.hot.join(" and ")} highest. Island range ${snap.min}–${snap.max}. NEA reading for ${fmtDT(now.timestamp)}.` : "Waiting for data"}</span> <span id="last-refresh" class="muted">Last refreshed ${fmtDT(GENERATED)}</span></p>
    </div>
    <div class="compass" id="regions" aria-label="24-hour PSI by region">
      ${REGIONS.map(regionTile).join("")}
    </div>
  </div>
</section>

<section class="block" aria-labelledby="h-table">
  <div class="block-head">
    <h2 id="h-table">Readings by region</h2>
    <p>24-hour PSI drives NEA's health advice. 1-hour PM2.5 shows what the air is like this hour.</p>
  </div>
  <div class="table-wrap"><table class="readings" id="readings">
    <thead><tr><th scope="col">Region</th><th scope="col">24-hr PSI</th><th scope="col">1-hr PM2.5 <small>µg/m³</small></th><th scope="col">24-hr PM2.5 <small>µg/m³</small></th><th scope="col">24-hr PM10 <small>µg/m³</small></th><th scope="col">8-hr O₃ <small>µg/m³</small></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>

<section class="block" aria-labelledby="h-trend">
  <div class="block-head">
    <h2 id="h-trend">PSI over the last 24 hours and the next 3 days</h2>
    <p>Solid line: highest regional 24-hour PSI reported by NEA. Dashed line: our model estimate. Shaded bands mark the PSI categories.</p>
  </div>
  <figure class="chart" id="chart"><div class="chart-empty muted">Loading chart…</div></figure>
</section>

<section class="block two" aria-labelledby="h-forecast">
  <div>
    <div class="block-head">
      <h2 id="h-forecast">Haze forecast</h2>
      <p>Estimated daily peak PSI. Treat this as a guide and follow NEA's official forecast alongside.</p>
    </div>
    <ol class="days" id="forecast-days"><li class="muted">Loading forecast…</li></ol>
    <p class="meta" id="forecast-note"></p>
    <div class="wind" id="wind">${windBlock()}</div>
  </div>
  <div>
    <div class="block-head"><h2>NEA's official outlook</h2></div>
    ${outlookBlock()}
  </div>
</section>

<section class="block" aria-labelledby="h-map">
  <div class="block-head">
    <h2 id="h-map">Fires and smoke around Singapore</h2>
    <p>Satellite hotspots and smoke haze areas mapped by NEA, refreshed every 30 minutes. Winds from the south and south-east carry this smoke to Singapore.</p>
  </div>
  ${mapBlock("region")}
</section>

<section class="block" aria-labelledby="h-season">
  <div class="block-head">
    <h2 id="h-season">PSI this haze season</h2>
  </div>
  ${seasonChart()}
</section>

<section class="block" aria-labelledby="h-situation">
  <div class="block-head"><h2 id="h-situation">The haze situation now</h2></div>
  <p class="lede">${esc(summary)}</p>
  <ul class="points">${curated.background.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
  <div class="cards">
    <a class="card" href="/singapore-haze-policy/"><span class="card-k">Singapore</span><span class="card-t">Haze Task Force measures, masks, schools and work rules</span></a>
    <a class="card" href="/indonesia-forest-fires/"><span class="card-k">Indonesia</span><span class="card-t">${hs ? `${num(hs.total)} hotspots on NEA's latest pass, mapped by area` : "Hotspots in Sumatra and Kalimantan"}</span></a>
    <a class="card" href="/malaysia-haze/"><span class="card-k">Malaysia</span><span class="card-t">School closures, API thresholds and the Sarawak emergency</span></a>
  </div>
</section>

<section class="block" aria-labelledby="h-news">
  <div class="block-head">
    <h2 id="h-news">Latest haze headlines</h2>
    <p>Updated every 30 minutes from news across the region.</p>
  </div>
  <div class="hl-cols">
    <div><h3>Singapore</h3>${headlineList("sg", 5)}</div>
    <div><h3>Indonesia</h3>${headlineList("id", 5)}</div>
    <div><h3>Malaysia</h3>${headlineList("my", 5)}</div>
  </div>
</section>

<section class="block" aria-labelledby="h-events">
  <div class="block-head"><h2 id="h-events">Key events</h2></div>
  ${keyEvents(curated.news.slice().sort(byDateDesc).slice(0, 6), { showRegion: true })}
</section>

<section class="block" aria-labelledby="h-health">
  <div class="block-head"><h2 id="h-health">What to do at each PSI level</h2></div>
  ${HEALTH_TABLE}
  <h3 class="sub">1-hour PM2.5 bands</h3>
  <div class="table-wrap"><table class="pm-bands">
    <thead><tr><th scope="col">Band</th><th scope="col">1-hr PM2.5 (µg/m³)</th><th scope="col">Use it for</th></tr></thead>
    <tbody>
      <tr><th scope="row">I Normal</th><td>0–55</td><td rowspan="4">Deciding on activities in the next hour or so</td></tr>
      <tr><th scope="row">II Elevated</th><td>56–150</td></tr>
      <tr><th scope="row">III High</th><td>151–250</td></tr>
      <tr><th scope="row">IV Very high</th><td>251 and above</td></tr>
    </tbody>
  </table></div>
</section>

<section class="block" aria-labelledby="h-faq">
  <div class="block-head"><h2 id="h-faq">Haze questions</h2></div>
  ${faqHtml}
</section>`;

  return layout({
    path: "/",
    title,
    description,
    body,
    bodyAttrs: `class="home"${snap ? ` data-band="${snap.band.key}"` : ""}`,
    scripts: `<script src="/assets/live.js?v=${VER}" defer></script>\n<script src="/assets/app.js?v=${VER}" defer></script>\n${mapScript}`,
    jsonld: [
      { "@context": "https://schema.org", "@type": "WebSite", name: NAME, alternateName: "sgairquality.com", url: SITE + "/", inLanguage: "en-SG" },
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        description,
        url: SITE + "/",
        dateModified: GENERATED,
        about: [{ "@type": "Thing", name: "Air pollution in Singapore" }, { "@type": "Thing", name: "Southeast Asian haze" }],
        spatialCoverage: { "@type": "Place", name: "Singapore", geo: { "@type": "GeoCoordinates", latitude: 1.3521, longitude: 103.8198 } },
      },
      faqLd,
    ],
  });
}

// ---------- Singapore policy ----------
function policy() {
  const path = "/singapore-haze-policy/";
  const title = "Singapore Haze Measures 2026: Masks, Schools, Work Rules";
  const description = "What Singapore's Haze Task Force does at each PSI level in 2026: N95 mask handouts, MOE school closure rules, MOM work guidelines and the latest NEA advisory.";
  const body = `
<article class="page">
  <header class="page-head">
    <p class="crumb"><a href="/">Live PSI</a> <span aria-hidden="true">/</span> Singapore measures</p>
    <h1>Singapore haze measures and policy, 2026</h1>
    <p class="lede">What the government has announced, what kicks in at each PSI level, and where to find official updates. NEA's outlook and the headlines below refresh every 30 minutes.</p>
  </header>
  <section aria-labelledby="h-outlook"><h2 id="h-outlook">Latest NEA outlook</h2>${outlookBlock()}</section>
  <section aria-labelledby="h-levels">
    <h2 id="h-levels">What happens at each PSI level</h2>
    <div class="table-wrap"><table class="levels">
      <thead><tr><th scope="col">Trigger</th><th scope="col">Measure</th><th scope="col">Agency</th></tr></thead>
      <tbody>
        <tr><th scope="row">24-hr PSI above 100</th><td>NEA issues a daily haze advisory with a 24-hour PSI forecast, and the Haze Task Force activates its plans</td><td>NEA, Haze Task Force</td></tr>
        <tr><th scope="row">During any haze episode</th><td>Schools follow their haze management plans. Every MOE classroom has an air purifier</td><td>MOE</td></tr>
        <tr><th scope="row">During any haze episode</th><td>Employers assess risk for outdoor work, provide suitable masks and keep at least a week of N95 stock</td><td>MOM</td></tr>
        <tr><th scope="row">24-hr PSI very unhealthy (201–300)</th><td>People's Association grassroots groups distribute N95 masks to vulnerable residents through vending machines at transport hubs, Social Service Offices and PA venues</td><td>PA, NEA</td></tr>
        <tr><th scope="row">Next-day forecast hazardous (above 300)</th><td>MOE considers closing schools</td><td>MOE</td></tr>
        <tr><th scope="row">PSI above 400</th><td>MOM notes N95 masks may not protect enough for prolonged outdoor work</td><td>MOM</td></tr>
      </tbody>
    </table></div>
  </section>
  <section aria-labelledby="h-health"><h2 id="h-health">Health advice</h2>${HEALTH_TABLE}</section>
  <section aria-labelledby="h-hl"><h2 id="h-hl">Latest Singapore headlines</h2>${headlineList("sg", 8)}</section>
  <section aria-labelledby="h-timeline"><h2 id="h-timeline">Key events</h2>${keyEvents(curated.news.filter((n) => n.region === "sg").sort(byDateDesc))}</section>
  <section aria-labelledby="h-official">
    <h2 id="h-official">Official sources</h2>
    <ul class="links">
      <li><a href="https://www.haze.gov.sg/" rel="noopener">haze.gov.sg</a>: NEA's haze site with readings, advisories and the 24-hour forecast</li>
      <li><a href="https://www.moe.gov.sg/about-us/emergency-preparedness/haze-management" rel="noopener">MOE haze management</a>: what schools do during haze</li>
      <li><a href="https://www.mom.gov.sg/haze" rel="noopener">MOM haze guidelines</a>: employer duties and tripartite advisories</li>
      <li><a href="https://www.moh.gov.sg/others/haze/" rel="noopener">MOH haze page</a>: health advice and clinic support</li>
      <li><a href="https://www.sportsingapore.gov.sg/sports-education/sports-safety/haze-management-at-sport-singapore/" rel="noopener">Sport Singapore</a>: haze rules for sports facilities and events</li>
    </ul>
  </section>
</article>`;
  return layout({ path, title, description, body, scripts: `<script src="/assets/live.js?v=${VER}" defer></script>`, jsonld: [article(title, description, path), crumbs("Singapore measures", path)] });
}

// ---------- Indonesia ----------
function indonesia() {
  const path = "/indonesia-forest-fires/";
  const hs = live.hotspots;
  const title = "Indonesia Forest Fires 2026: Sumatra and Kalimantan Hotspots";
  const description = `Live map of Indonesian fire hotspots and smoke haze${hs ? ` (${num(hs.total)} on NEA's latest pass)` : ""}, counts by area, where Singapore's haze comes from and El Niño's role in 2026.`;
  const body = `
<article class="page">
  <header class="page-head">
    <p class="crumb"><a href="/">Live PSI</a> <span aria-hidden="true">/</span> Indonesia fires</p>
    <h1>Indonesia forest fires and hotspots, 2026</h1>
    <p class="lede">Most of the haze over Singapore comes from forest and peatland fires in Sumatra and Kalimantan. The map, counts and headlines on this page refresh every 30 minutes.</p>
  </header>
  <section aria-labelledby="h-map"><h2 id="h-map">Hotspot and smoke map</h2>${mapBlock("region")}</section>
  <section aria-labelledby="h-hotspots">
    <h2 id="h-hotspots">Hotspots by area</h2>
    ${hs ? `<p class="stat"><strong>${num(hs.total)}</strong> hotspots detected by NEA${hs.asOf ? ` on ${fmtDT(hs.asOf)}` : ""}.</p>` : ""}
    ${hotspotTable()}
    <p class="meta">A hotspot is a heat anomaly picked up by satellite, not a confirmed fire, and cloud cover can hide some. Indonesia's own SiPongi system counts more points because it includes lower-confidence detections.</p>
    ${hotspotTrend()}
  </section>
  <section aria-labelledby="h-hl"><h2 id="h-hl">Latest Indonesia headlines</h2>${headlineList("id", 8)}</section>
  <section aria-labelledby="h-why">
    <h2 id="h-why">Why the fires happen</h2>
    <p>Large areas of Sumatra and Kalimantan sit on peat, thick layers of waterlogged plant matter. When peatland is drained for plantations it dries out, and fires lit to clear land, often called slash-and-burn, can spread underground and smoulder for weeks. Peat smoke is dense and rich in fine particles, which is why it pushes up PM2.5 so sharply.</p>
    <p>From roughly August to October, winds over the region blow from the south-east and south. That carries smoke from southern Sumatra (South Sumatra, Jambi, Riau) and from West and Central Kalimantan towards Singapore and Peninsular Malaysia. Sarawak, which borders Kalimantan, is often hit first.</p>
  </section>
  <section aria-labelledby="h-elnino">
    <h2 id="h-elnino">El Niño and the Indian Ocean Dipole</h2>
    <p>2026 brought a very strong El Niño, warmer than usual waters in the central Pacific that shift rain away from Southeast Asia. A positive Indian Ocean Dipole added to the drying. Together they gave the region a longer, harsher dry season. Experts do not expect a repeat of the record 2015 haze, because this El Niño began around June instead of April, but they warn the dry spell may last into November.</p>
  </section>
  <section aria-labelledby="h-timeline"><h2 id="h-timeline">Key events</h2>${keyEvents(curated.news.filter((n) => n.region === "id" || n.region === "regional").sort(byDateDesc), { showRegion: true })}</section>
  <section aria-labelledby="h-official">
    <h2 id="h-official">Track the fires yourself</h2>
    <ul class="links">
      <li><a href="https://asmc.asean.org/" rel="noopener">ASEAN Specialised Meteorological Centre</a>: daily regional haze maps and alert levels</li>
      <li><a href="https://sipongi.menlhk.go.id/" rel="noopener">SiPongi</a>: Indonesia's official forest and land fire monitoring system</li>
      <li><a href="https://firms.modaps.eosdis.nasa.gov/map/" rel="noopener">NASA FIRMS</a>: near real-time satellite fire detections worldwide</li>
    </ul>
  </section>
</article>`;
  return layout({ path, title, description, body, scripts: `<script src="/assets/live.js?v=${VER}" defer></script>\n${mapScript}`, jsonld: [article(title, description, path), crumbs("Indonesia fires", path)] });
}

// ---------- Malaysia ----------
function malaysia() {
  const path = "/malaysia-haze/";
  const title = "Malaysia Haze 2026: API, School Closures and Emergency";
  const description = "Malaysia's 2026 haze: school closures in KL, Selangor and Johor, new API closure rules, the Serian emergency in Sarawak, and how API compares with PSI.";
  const body = `
<article class="page">
  <header class="page-head">
    <p class="crumb"><a href="/">Live PSI</a> <span aria-hidden="true">/</span> Malaysia</p>
    <h1>Malaysia haze, 2026</h1>
    <p class="lede">The same smoke that reaches Singapore is affecting Peninsular Malaysia and Sarawak. Headlines refresh every 30 minutes.</p>
  </header>
  <section aria-labelledby="h-hl"><h2 id="h-hl">Latest Malaysia headlines</h2>${headlineList("my", 8)}</section>
  <section aria-labelledby="h-api">
    <h2 id="h-api">Malaysia's Air Pollutant Index</h2>
    <p>Malaysia uses the Air Pollutant Index (API), which has bands similar to Singapore's PSI. The numbers are not directly interchangeable, because each country weights pollutants and averages them differently.</p>
    <div class="table-wrap"><table class="levels">
      <thead><tr><th scope="col">API</th><th scope="col">Status</th><th scope="col">What happens</th></tr></thead>
      <tbody>
        <tr><th scope="row">0–50</th><td>Good</td><td>Normal activities</td></tr>
        <tr><th scope="row">51–100</th><td>Moderate</td><td>Normal activities</td></tr>
        <tr><th scope="row">101–200</th><td>Unhealthy</td><td>From 12 Oct 2026, schools close if above 150 for three days in a row</td></tr>
        <tr><th scope="row">181 and above</th><td>Unhealthy</td><td>From 9 Oct 2026, schools in the area must close</td></tr>
        <tr><th scope="row">201–300</th><td>Very unhealthy</td><td>District closures of schools, kindergartens and nurseries</td></tr>
        <tr><th scope="row">301 and above</th><td>Hazardous</td><td>Wider closures and restrictions</td></tr>
        <tr><th scope="row">Above 500</th><td>Emergency</td><td>A local state of emergency can be declared</td></tr>
      </tbody>
    </table></div>
    <p class="meta">Live readings: <a href="https://eqms.doe.gov.my/APIMS/main" rel="noopener">APIMS, Department of Environment Malaysia</a>.</p>
  </section>
  <section aria-labelledby="h-timeline"><h2 id="h-timeline">Key events</h2>${keyEvents(curated.news.filter((n) => n.region === "my").sort(byDateDesc))}</section>
</article>`;
  return layout({ path, title, description, body, scripts: `<script src="/assets/live.js?v=${VER}" defer></script>`, jsonld: [article(title, description, path), crumbs("Malaysia", path)] });
}

function notFound() {
  return layout({
    path: "/404.html",
    title: "Page not found | SG Air Quality",
    description: "This page does not exist. See live Singapore PSI readings instead.",
    body: `<article class="page"><header class="page-head"><h1>That page doesn't exist</h1><p class="lede"><a href="/">See today's PSI readings</a> or pick a page from the menu.</p></header></article>`,
  }).replace('<meta name="robots" content="index, follow, max-image-preview:large">', '<meta name="robots" content="noindex">');
}

// ---------- build ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const f of ["assets", "robots.txt", "site.webmanifest", "CNAME"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(DIST, f), { recursive: true });
mkdirSync(join(DIST, "data"), { recursive: true });
for (const f of ["live.json", "history.json", "updates.json"]) if (existsSync(join(ROOT, "data", f))) cpSync(join(ROOT, "data", f), join(DIST, "data", f));
writeFileSync(join(DIST, ".nojekyll"), "");

write("index.html", home());
write("singapore-haze-policy/index.html", policy());
write("indonesia-forest-fires/index.html", indonesia());
write("malaysia-haze/index.html", malaysia());
write("404.html", notFound());

const lastmod = GENERATED.slice(0, 10);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${SITE}${p.path}</loc><lastmod>${lastmod}</lastmod><changefreq>${p.path === "/" ? "hourly" : "daily"}</changefreq><priority>${p.path === "/" ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`
);
write(
  "llms.txt",
  `# SG Air Quality (sgairquality.com)

> Independent tracker of Singapore's air quality during the 2026 Southeast Asian haze. Live 24-hour PSI and 1-hour PM2.5 for Singapore's five regions, NEA's 24-hour forecast, a 3-day model PSI estimate, a map of NEA fire hotspots and smoke haze, and regional headlines. Everything refreshes every 30 minutes.

${snap ? `Latest: 24-hour PSI ${snap.min}–${snap.max} (${snap.band.label}) at ${fmtDT(now.timestamp)} SGT. NEA 24-hour forecast: ${live.advisory?.forecastBand || "n/a"}.` : ""}

## Pages
- [Live PSI and forecast](${SITE}/): live readings, PSI trend, haze forecast, hotspot map, season history, FAQ
- [Singapore haze measures](${SITE}/singapore-haze-policy/): Haze Task Force actions, N95 masks, MOE and MOM rules
- [Indonesia forest fires](${SITE}/indonesia-forest-fires/): hotspot map and counts by area, causes, El Niño
- [Malaysia haze](${SITE}/malaysia-haze/): API thresholds, school closures, Sarawak emergency

## Data (JSON)
- [live.json](${SITE}/data/live.json): PSI snapshot, NEA advisory, hotspots, haze areas, headlines (every 30 min)
- [history.json](${SITE}/data/history.json): daily peak PSI and hotspot totals this season
`
);
console.log("built dist/ from data generated", GENERATED);

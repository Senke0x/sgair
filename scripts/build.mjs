#!/usr/bin/env node
// Builds sgairquality.com into dist/ from:
//   data/live.json     auto, every 30 min (scripts/update.mjs)
//   data/history.json  auto, daily (hotspot totals)
//   data/daily.json    auto, daily peak PSI and PM2.5 for this year vs last year
//   data/updates.json  curated background + key events
// No dependencies. Run: node scripts/build.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const dailyData = readJSON("data/daily.json", { days: {} });
const charts = createRequire(import.meta.url)(join(ROOT, "assets/charts.js"));
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
  { path: "/", label: "PSI live" },
  { path: "/pm25/", label: "PM2.5 live" },
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

// ---------- 24-hour PSI and PM2.5 trends ----------
function trendBlock({ only } = {}) {
  const t = live.trend || { psi: [], pm: [] };
  const chips = ["max", ...charts.REGIONS]
    .map((r) => `<button type="button" class="map-btn" data-region="${r}" aria-pressed="${r === "max"}">${charts.NAME[r]}</button>`)
    .join("");
  const fig = (kind, id, h, note) => `<div class="trend-panel">
      <h3>${h}</h3>
      <figure class="chart" id="${id}">${charts.svg(kind, t[kind], "max")}</figure>
      <p class="meta">${note}</p>
    </div>`;
  const psiFig = fig("psi", "chart-psi", "24-hour PSI, last 24 hours", "NEA updates the 24-hour PSI every hour. It drives the official health advice.");
  const pmFig = fig("pm", "chart-pm", "1-hour PM2.5, last 24 hours", "Hourly fine-particle concentration in µg/m³. Best for deciding what to do in the next hour.");
  return `<div class="trend-tools map-tools" role="group" aria-label="Choose a region">${chips}</div>
  <div class="trend-grid${only ? " single" : ""}">${only === "pm" ? pmFig + psiFig : psiFig + pmFig}</div>
  <script type="application/json" id="trend-data">${JSON.stringify(t).replace(/</g, "\\u003c")}</script>`;
}

// ---------- this year vs last year: PSI and PM2.5, past month or past year ----------
// data/daily.json: { days: { "YYYY-MM-DD": [peak 24-hr PSI, peak 24-hr PM2.5] | null } }
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const minusYear = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
function compareData(n) {
  const days = dailyData.days || {};
  const have = Object.keys(days).filter((d) => days[d]).sort();
  if (have.length < 2) return null;
  const end = have[have.length - 1]; // latest complete day
  const rows = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = addDays(end, -k), p = minusYear(d);
    rows.push({ d, p, a: days[d] || null, b: days[p] || null, known: d in days && p in days });
  }
  return { end, rows };
}
function compareSvg(kind, n) {
  const cd = compareData(n);
  if (!cd) return "";
  const idx = kind === "psi" ? 0 : 1;
  const rows = cd.rows.map((r) => ({ ...r, va: r.a ? r.a[idx] : null, vb: r.b ? r.b[idx] : null }));
  const vals = rows.flatMap((r) => [r.va, r.vb]).filter((v) => v != null);
  if (!vals.length) return "";
  const ref = kind === "psi" ? { v: 100, t: "Unhealthy above 100" } : { v: 55, t: "55 µg/m³, about PSI 100" };
  const W = 560, H = 250, L = 34, R = 10, T = 14, B = 28;
  const step0 = kind === "psi" ? 50 : 25;
  const peak = Math.max(ref.v * 1.3, ...vals);
  let step = step0; while (peak * 1.1 / step > 7) step *= 2;
  const yMax = Math.ceil((peak * 1.1) / step) * step;
  const X = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => T + (1 - v / yMax) * (H - T - B);
  let grid = "", axis = "";
  for (let v = 0; v <= yMax; v += step) { grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`; axis += `<text x="${L - 5}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`; }
  rows.forEach((r, i) => {
    const day = +r.d.slice(8, 10), mon = MONTHS[+r.d.slice(5, 7) - 1];
    const tick = n <= 31 ? (n - 1 - i) % 7 === 0 : day === 1;
    if (!tick) return;
    const lbl = n <= 31 ? `${day} ${mon}` : r.d.slice(5, 7) === "01" ? `${mon} ${r.d.slice(0, 4)}` : mon;
    const anchor = X(i) > W - R - 20 ? "end" : X(i) < L + 20 ? "start" : "middle";
    grid += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${T}" y2="${H - B}" opacity=".5"/>`;
    axis += `<text x="${X(i).toFixed(1)}" y="${H - 9}" text-anchor="${anchor}">${lbl}</text>`;
  });
  const path = (key) => {
    let d = "", pen = false;
    rows.forEach((r, i) => { const v = r[key]; if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  // hover data: one empty <g class="pt"> per day, read by the tooltip in app.js
  const unit = kind === "psi" ? "24-hr PSI" : "24-hr PM2.5 µg/m³";
  const hits = rows
    .map((r, i) => {
      const ys = [r.va != null ? `${Y(r.va).toFixed(1)}~c-this` : "", r.vb != null ? `${Y(r.vb).toFixed(1)}~c-last` : ""].filter(Boolean).join("|");
      const ls = `c-this~${r.d.slice(0, 4)}~${r.va ?? "no data"}|c-last~${r.p.slice(0, 4)}~${r.vb ?? "no data"}`;
      return `<g class="pt" data-x="${X(i).toFixed(1)}" data-y="${ys}" data-t="${fmtDate(r.d).replace(/ \d{4}$/, "")} · ${unit}" data-l="${ls}"></g>`;
    })
    .join("");
  const label = `${kind === "psi" ? "Daily peak 24-hour PSI" : "Daily peak 24-hour PM2.5"}, ${n <= 31 ? "past 30 days" : "past 12 months"}, this year compared with the same dates last year.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    <g class="grid">${grid}</g><g class="axis">${axis}</g>
    <line class="limit" x1="${L}" x2="${W - R}" y1="${Y(ref.v).toFixed(1)}" y2="${Y(ref.v).toFixed(1)}"/><text class="limit-t" x="${L + 4}" y="${(Y(ref.v) + 13).toFixed(1)}">${ref.t}</text>
    <path class="ln-last" d="${path("vb")}"/><path class="ln-this" d="${path("va")}"/>
    <rect class="hit-area" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>${hits}
  </svg>`;
}
function compareBlock() {
  const month = compareData(30);
  if (!month) return `<p class="muted">The comparison appears here once a month of daily readings has been collected.</p>`;
  const year = compareData(365);
  const known = year.rows.filter((r) => r.known).length;
  const yearReady = known >= 30; // the year view fills in over about a day of scheduled runs
  const tyLabel = month.end.slice(0, 4), lyLabel = String(+month.end.slice(0, 4) - 1);
  const view = (n, hidden) => `<div class="cmp-grid" data-range-view="${n}"${hidden ? " hidden" : ""}>
      <div class="trend-panel"><h3>24-hour PSI <small>daily peak, highest region</small></h3><figure class="chart cmp-chart">${compareSvg("psi", n)}</figure></div>
      <div class="trend-panel"><h3>24-hour PM2.5 <small>µg/m³, daily peak, highest region</small></h3><figure class="chart cmp-chart">${compareSvg("pm", n)}</figure></div>
    </div>`;
  return `<div class="cmp-tools">
    <div class="map-tools" role="group" aria-label="Comparison period">
      <button type="button" class="map-btn" data-range="30" aria-pressed="true">1 month</button>
      ${yearReady ? `<button type="button" class="map-btn" data-range="365" aria-pressed="false">1 year</button>` : ""}
    </div>
    <p class="cmp-legend"><span class="key k-this"></span>This year <span class="key k-last"></span>Last year, same dates</p>
  </div>
  ${view(30, false)}
  ${yearReady ? view(365, true) : ""}
  <p class="meta">Each point is the day's highest regional 24-hour reading from NEA, up to ${fmtDate(month.end)}. Hover or tap the chart to see both years for any day.${yearReady && known < 365 ? ` <span data-range-note="365" hidden>Older days are being added a few at a time to keep the load on NEA's servers light: ${known} of 365 days so far.</span>` : ""}</p>`;
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
    { "@type": "ListItem", position: 1, name: "PSI live", item: SITE + "/" },
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

// ---------- live snapshot sentences (also used in FAQ answers, meta and llms.txt) ----------
const pmNow = now?.pm25_1h ? REGIONS.map((r) => now.pm25_1h[r]).filter((v) => typeof v === "number") : [];
const pmSnap = pmNow.length
  ? { max: Math.max(...pmNow), min: Math.min(...pmNow), hot: REGIONS.filter((r) => now.pm25_1h[r] === Math.max(...pmNow)).map((r) => RNAME[r]), ts: now.pm25_1h_timestamp || now.timestamp }
  : null;
const psiSentence = snap
  ? `At ${fmtDT(now.timestamp)} SGT, Singapore's 24-hour PSI was ${snap.min}–${snap.max} (${snap.band.label.toLowerCase()}), highest in the ${snap.hot.join(" and ")}.`
  : "";
const pmSentence = pmSnap
  ? `The 1-hour PM2.5 reading was ${pmSnap.min}–${pmSnap.max} µg/m³ at ${fmtDT(pmSnap.ts)} SGT, highest in the ${pmSnap.hot.join(" and ")} (${pmBand(pmSnap.max)}).`
  : "";
const yearSentence = (() => {
  const cd = compareData(30);
  if (!cd) return "";
  const avg = (key, i) => { const v = cd.rows.map((r) => r[key] && r[key][i]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const [pa, pb, ma, mb] = [avg("a", 0), avg("b", 0), avg("a", 1), avg("b", 1)];
  if (pa == null || pb == null) return "";
  return `Over the 30 days to ${fmtDate(cd.end)}, Singapore's daily peak 24-hour PSI averaged ${pa}${ma != null ? ` and daily peak 24-hour PM2.5 averaged ${ma} µg/m³` : ""}, compared with ${pb}${mb != null ? ` and ${mb} µg/m³` : ""} over the same dates a year earlier.`;
})();

// ---------- FAQ ----------
const FAQ = [
  ...(snap ? [["What is the PSI in Singapore now?", `${psiSentence} The reading on this page updates live from NEA every 30 minutes.`]] : []),
  ...(pmSnap ? [["What is the PM2.5 level in Singapore now?", `${pmSentence} NEA publishes a new 1-hour PM2.5 reading every hour.`]] : []),
  ["What is the PSI in Singapore?", "The Pollutant Standards Index is the air quality index used by Singapore's National Environment Agency. It combines six pollutants: PM2.5, PM10, ozone, carbon monoxide, sulphur dioxide and nitrogen dioxide. Each one gets a sub-index and the PSI is the highest of them. During haze, PM2.5 almost always sets the PSI."],
  ["What PSI level is unhealthy?", "A 24-hour PSI of 0 to 50 is good and 51 to 100 is moderate. 101 to 200 is unhealthy, 201 to 300 is very unhealthy, and anything above 300 is hazardous."],
  ["Should I look at the 24-hour PSI or the 1-hour PM2.5?", "Use the 24-hour PSI and NEA's forecast to plan the next day, and follow the health advice for that band. Use the 1-hour PM2.5 reading to decide on something you are about to do right now, such as a run."],
  ...(yearSentence ? [["How does this year's haze compare with last year?", `${yearSentence} The charts on this page compare both years day by day, over the past month or the past year.`]] : []),
  ["Is it safe to exercise outdoors during the haze?", "At an unhealthy PSI, healthy adults should cut down on long or strenuous outdoor exercise. Children, the elderly and pregnant women should keep it to a minimum, and people with heart or lung conditions should avoid it. At very unhealthy levels, everyone should avoid strenuous outdoor activity."],
  ["Do I need an N95 mask?", "Not for short exposure such as commuting or walking between buildings, or when you are indoors. An N95 mask helps if you must spend long periods outdoors when the PSI is unhealthy or worse. N95 masks are not designed for young children, and the elderly, pregnant women and people with heart or lung conditions should ask a doctor first."],
  ["When do schools close in Singapore because of haze?", "MOE considers closing schools when the next day's 24-hour PSI forecast is hazardous, above 300. In 2015, MOE primary and secondary schools, special education schools and kindergartens closed for one day. Every MOE classroom now has an air purifier."],
  ["Where does the haze come from?", "Mostly from forest and peatland fires in Indonesia, especially southern and central Sumatra and Kalimantan, many started to clear land. From August to October, south-easterly and southerly winds carry the smoke towards Singapore and Peninsular Malaysia."],
  ["How often does this page update?", "Every 30 minutes. The PSI and PM2.5 readings are pulled straight from NEA in your browser, and the site itself rebuilds every 30 minutes with NEA's latest forecast, satellite hotspots, smoke haze areas and news headlines. NEA publishes new readings every hour."],
  ["How is the haze forecast on this page made?", "It takes hourly PM2.5 forecasts from the CAMS global atmospheric model (via Open-Meteo), scales them to match the latest NEA readings, and converts the result to the PSI scale. It is an estimate, not an official forecast. NEA's daily advisory is the official one."],
];
const PM_FAQ = [
  ...(pmSnap ? [["What is the PM2.5 level in Singapore now?", `${pmSentence} This page updates live from NEA every 30 minutes.`]] : []),
  ["What is PM2.5?", "PM2.5 is fine particulate matter 2.5 micrometres across or smaller, about thirty times thinner than a human hair. It gets deep into the lungs and bloodstream. Smoke from peat and forest fires is mostly PM2.5, so it is the pollutant that rises fastest during haze."],
  ["What is a safe PM2.5 level in Singapore?", "NEA's 1-hour PM2.5 bands are: Band I Normal 0–55 µg/m³, Band II Elevated 56–150, Band III High 151–250 and Band IV Very high above 250. Band I is fine for normal activity. In Band II and above, reduce strenuous outdoor activity, especially if you are sensitive to haze."],
  ["What is the difference between 1-hour PM2.5 and 24-hour PSI?", "The 1-hour PM2.5 shows how much fine particulate is in the air this hour, so it reacts quickly when smoke drifts in or clears. The 24-hour PSI averages over a day and covers six pollutants. NEA's health advice is based on the 24-hour PSI, while the 1-hour PM2.5 is for deciding on activities in the next few hours."],
  ["How is 24-hour PM2.5 turned into PSI?", "NEA converts the 24-hour average PM2.5 into a sub-index: 12 µg/m³ is a PSI of 50, 55 µg/m³ is 100, 150 µg/m³ is 200, 250 µg/m³ is 300 and 350 µg/m³ is 400. The PSI is the highest of the six pollutant sub-indices, which during haze is almost always PM2.5."],
  ["Do air purifiers help with PM2.5?", "Yes. A purifier with a true HEPA filter, sized for the room and run with windows and doors closed, removes most PM2.5 indoors. Fans and air conditioners that only recirculate air do not filter particles unless they have a suitable filter."],
];
const faqHtml = (list) => `<div class="faq">${list.map(([q, a]) => `<details><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join("")}</div>`;
const faqLd = (list) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: list.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });

const datasetLd = (path) => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Singapore live PSI and PM2.5 readings by region",
  description: "24-hour PSI, 1-hour PM2.5, 24-hour PM2.5, PM10 and ozone for the North, South, East, West and Central regions of Singapore, refreshed every 30 minutes from the National Environment Agency, with a comparison of this haze season against last year.",
  url: SITE + path,
  isAccessibleForFree: true,
  license: "https://data.gov.sg/open-data-licence",
  creator: { "@type": "Organization", name: "National Environment Agency", url: "https://www.nea.gov.sg/" },
  publisher: { "@type": "Organization", name: NAME, url: SITE },
  
  dateModified: GENERATED,
  spatialCoverage: { "@type": "Place", name: "Singapore", geo: { "@type": "GeoCoordinates", latitude: 1.3521, longitude: 103.8198 } },
  variableMeasured: ["24-hour PSI", "1-hour PM2.5", "24-hour PM2.5", "24-hour PM10", "8-hour ozone"],
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: SITE + "/data/live.json" },
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: SITE + "/data/daily.json" },
  ],
});

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

const PM_TABLE = `<div class="table-wrap"><table class="pm-bands health">
    <caption>NEA 1-hour PM2.5 bands</caption>
    <thead><tr><th scope="col">Band</th><th scope="col">1-hr PM2.5 (µg/m³)</th><th scope="col">What to do in the next hour or so</th></tr></thead>
    <tbody>
      <tr class="b-good"><th scope="row"><span class="dot"></span>I Normal</th><td>0–55</td><td>Normal activities</td></tr>
      <tr class="b-unhealthy"><th scope="row"><span class="dot"></span>II Elevated</th><td>56–150</td><td>Consider cutting back strenuous outdoor activity, especially sensitive groups</td></tr>
      <tr class="b-very"><th scope="row"><span class="dot"></span>III High</th><td>151–250</td><td>Move strenuous activity indoors. Sensitive groups stay inside</td></tr>
      <tr class="b-hazardous"><th scope="row"><span class="dot"></span>IV Very high</th><td>251 and above</td><td>Everyone stays indoors where possible</td></tr>
    </tbody>
  </table></div>`;

const mapScript = `<script src="/assets/map.js?v=${VER}" defer></script>`;
const liveScripts = `<script src="/assets/live.js?v=${VER}" defer></script>\n<script src="/assets/charts.js?v=${VER}" defer></script>\n<script src="/assets/app.js?v=${VER}" defer></script>`;
const PM_ADVICE = {
  "Band I Normal": "PM2.5 is in the normal band this hour. Outdoor plans are fine.",
  "Band II Elevated": "PM2.5 is elevated this hour. Consider a shorter or easier session outdoors, especially if you are sensitive to haze.",
  "Band III High": "PM2.5 is high this hour. Move strenuous activity indoors, and sensitive groups should stay inside.",
  "Band IV Very high": "PM2.5 is very high this hour. Stay indoors with windows closed and an air purifier on if you have one.",
};
const pmKey = (v) => (v <= 55 ? "good" : v <= 150 ? "unhealthy" : v <= 250 ? "very" : "hazardous");

function readingsTable() {
  const rows = now
    ? REGIONS.slice()
        .sort((a, b) => now.psi[b] - now.psi[a])
        .map((k) => {
          const bb = bandOf(now.psi[k]), p1 = now.pm25_1h?.[k];
          return `<tr><th scope="row">${RNAME[k]}</th><td><span class="pill ${bb.key}">${now.psi[k]}</span> <span class="pm-tag">${bb.label}</span></td><td>${p1 != null ? `<span class="pill ${pmKey(p1)}">${p1}</span> <span class="pm-tag">${pmBand(p1)}</span>` : "–"}</td><td>${now.pm25_24h?.[k] ?? "–"}</td><td>${now.pm10_24h?.[k] ?? "–"}</td><td>${now.o3_8h?.[k] ?? "–"}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
  return `<div class="table-wrap"><table class="readings" id="readings">
    <thead><tr><th scope="col">Region</th><th scope="col">24-hr PSI</th><th scope="col">1-hr PM2.5 <small>µg/m³</small></th><th scope="col">24-hr PM2.5 <small>µg/m³</small></th><th scope="col">24-hr PM10 <small>µg/m³</small></th><th scope="col">8-hr O₃ <small>µg/m³</small></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// hero for both live pages; lead = "psi" or "pm"
function hero(lead) {
  const isPm = lead === "pm";
  const regionTile = (r) => {
    const v = now?.psi?.[r], pm = now?.pm25_1h?.[r];
    const big = isPm ? pm : v;
    const key = isPm ? (pm != null ? pmKey(pm) : "") : typeof v === "number" ? bandOf(v).key : "";
    return `<div class="reg reg-${r}" data-region="${r}"${key ? ` data-band="${key}"` : ""}>
        <span class="reg-name">${RNAME[r]}</span>
        <span class="reg-psi">${big ?? "–"}</span>
        <span class="reg-pm">${isPm ? `PSI ${v ?? "–"}` : `PM2.5 ${pm ?? "–"}`}</span>
      </div>`;
  };
  const psiRO = `<div class="ro ro-psi">
        <span class="ro-k">24-hr PSI <small>highest region</small></span>
        <div class="psi-readout"><span class="psi-num" id="psi-max">${snap ? snap.max : "–"}</span><span class="psi-band" id="psi-band"${snap ? ` data-band="${snap.band.key}"` : ""}>${snap ? snap.band.label : "Loading"}</span></div>
      </div>`;
  const pmRO = `<div class="ro ro-pm">
        <span class="ro-k">1-hr PM2.5 <small>µg/m³, highest region</small></span>
        <div class="psi-readout"><span class="psi-num" id="pm-max">${pmSnap ? pmSnap.max : "–"}</span><span class="psi-band" id="pm-band"${pmSnap ? ` data-band="${pmKey(pmSnap.max)}"` : ""}>${pmSnap ? pmBand(pmSnap.max) : "Loading"}</span></div>
      </div>`;
  const stampText = isPm
    ? pmSnap ? `Highest 1-hr PM2.5 in ${pmSnap.hot.join(" and ")}. NEA reading for ${fmtDT(pmSnap.ts)}.` : "Waiting for data"
    : snap ? `${snap.hot.join(" and ")} highest. Island range ${snap.min}–${snap.max}. NEA reading for ${fmtDT(now.timestamp)}.` : "Waiting for data";
  return `<section class="hero" id="now" aria-labelledby="h1">
  <div class="sky" aria-hidden="true"><div class="haze-layer"></div>${skyline}</div>
  <div class="hero-inner">
    <div class="hero-main">
      <h1 id="h1">${isPm ? "Singapore PM2.5 live" : "Singapore PSI live"} <span class="h1-sub">${isPm ? "1-hour PM2.5 and PSI now" : "PSI and PM2.5 readings now"}</span></h1>
      <div class="readouts${isPm ? " pm-first" : ""}" aria-live="polite">${isPm ? pmRO + psiRO : psiRO + pmRO}</div>
      <p class="advice" id="${isPm ? "pm-advice" : "psi-advice"}">${isPm ? (pmSnap ? PM_ADVICE[pmBand(pmSnap.max)] : "Readings load from NEA every 30 minutes.") : snap ? ADVICE[snap.band.key] : "Readings load from the National Environment Agency every 30 minutes."}</p>
      <p class="stamp"><span class="live" title="Readings update automatically every 30 minutes"><span class="live-dot" aria-hidden="true"></span>Live</span> <span id="psi-time">${stampText}</span> <span id="last-refresh" class="muted">Last refreshed ${fmtDT(GENERATED)}</span></p>
    </div>
    <div class="compass" id="regions" aria-label="${isPm ? "1-hour PM2.5" : "24-hour PSI"} by region">
      ${REGIONS.map(regionTile).join("")}
    </div>
  </div>
</section>`;
}

// ---------- Home ----------
function home() {
  const title = "Singapore PSI Live Now: PSI & PM2.5 Today, Every 30 Min";
  const description = `Live Singapore PSI and PM2.5 now for North, South, East, West and Central${snap ? ` (24-hr PSI ${snap.min}–${snap.max}, ${snap.band.label.toLowerCase()})` : ""}. 24-hour trends, haze forecast and this year vs last year.`;
  const hs = live.hotspots;
  const summary = snap
    ? `${psiSentence} ${pmSentence}${live.advisory?.forecastBand ? ` NEA forecasts the 24-hour PSI to be ${live.advisory.forecastBand.toLowerCase()} over the next 24 hours.` : ""}${hs ? ` NEA's latest satellite pass found ${num(hs.total)} hotspots in the region, ${num(hs.byRegion.find((r) => r.name === "Kalimantan")?.count || 0)} in Kalimantan and ${num(hs.byRegion.find((r) => r.name === "Sumatra")?.count || 0)} in Sumatra.` : ""}`
    : "";

  const body = `
${hero("psi")}

<section class="block" aria-labelledby="h-table">
  <div class="block-head">
    <h2 id="h-table">PSI and PM2.5 by region now</h2>
    <p>24-hour PSI drives NEA's health advice. 1-hour PM2.5 shows what the air is like this hour. <a href="/pm25/">PM2.5 live page</a></p>
  </div>
  ${readingsTable()}
</section>

<section class="block" aria-labelledby="h-trend">
  <div class="block-head">
    <h2 id="h-trend">PSI and PM2.5 trend, last 24 hours</h2>
    <p>Hourly NEA readings. Pick a region to see its own line. Shaded bands mark the official categories.</p>
  </div>
  ${trendBlock()}
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

<section class="block" aria-labelledby="h-years">
  <div class="block-head">
    <h2 id="h-years">PSI and PM2.5: this year vs last year</h2>
    <p>Each day's peak reading compared with the same date a year earlier.</p>
  </div>
  ${compareBlock()}
</section>

<section class="block" aria-labelledby="h-map">
  <div class="block-head">
    <h2 id="h-map">Fires and smoke around Singapore</h2>
    <p>Satellite hotspots and smoke haze areas mapped by NEA, refreshed every 30 minutes. Winds from the south and south-east carry this smoke to Singapore.</p>
  </div>
  ${mapBlock("region")}
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
    <div><h3>Singapore</h3>${headlineList("sg", 4)}</div>
    <div><h3>Indonesia</h3>${headlineList("id", 4)}</div>
    <div><h3>Malaysia</h3>${headlineList("my", 4)}</div>
  </div>
</section>

<section class="block" aria-labelledby="h-health">
  <div class="block-head"><h2 id="h-health">What to do at each PSI and PM2.5 level</h2></div>
  ${HEALTH_TABLE}
  <h3 class="sub">1-hour PM2.5 bands</h3>
  ${PM_TABLE}
</section>

<section class="block" aria-labelledby="h-faq">
  <div class="block-head"><h2 id="h-faq">PSI and haze questions</h2></div>
  ${faqHtml(FAQ)}
</section>`;

  return layout({
    path: "/",
    title,
    description,
    body,
    bodyAttrs: `class="home"${snap ? ` data-band="${snap.band.key}"` : ""}`,
    scripts: `${liveScripts}\n${mapScript}`,
    jsonld: [
      { "@context": "https://schema.org", "@type": "WebSite", name: NAME, alternateName: ["sgairquality.com", "SG PSI live"], url: SITE + "/", inLanguage: "en-SG" },
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        description,
        url: SITE + "/",
        dateModified: GENERATED,
        about: [{ "@type": "Thing", name: "Pollutant Standards Index" }, { "@type": "Thing", name: "PM2.5" }, { "@type": "Thing", name: "Southeast Asian haze" }],
        speakable: { "@type": "SpeakableSpecification", cssSelector: ["#h1", "#psi-time", ".advice"] },
      },
      datasetLd("/"),
      faqLd(FAQ),
    ],
  });
}

// ---------- PM2.5 live ----------
function pm25() {
  const path = "/pm25/";
  const title = "Singapore PM2.5 Live Now: 1-Hour PM2.5 by Region Today";
  const description = `Live 1-hour PM2.5 in Singapore now${pmSnap ? ` (${pmSnap.min}–${pmSnap.max} µg/m³)` : ""} for North, South, East, West and Central, updated every 30 minutes from NEA, with a 24-hour PM2.5 trend and band guide.`;
  const body = `
${hero("pm")}

<section class="block" aria-labelledby="h-trend">
  <div class="block-head">
    <h2 id="h-trend">PM2.5 trend, last 24 hours</h2>
    <p>Hourly NEA readings in µg/m³. Pick a region to see its own line. Shaded bands mark NEA's PM2.5 bands.</p>
  </div>
  ${trendBlock({ only: "pm" })}
</section>

<section class="block" aria-labelledby="h-table">
  <div class="block-head">
    <h2 id="h-table">PM2.5 and PSI by region now</h2>
    <p>${esc(pmSentence)} <a href="/">PSI live page</a></p>
  </div>
  ${readingsTable()}
</section>

<section class="block" aria-labelledby="h-bands">
  <div class="block-head"><h2 id="h-bands">What the PM2.5 bands mean</h2></div>
  ${PM_TABLE}
  <p class="meta">NEA's health advice for the next day is based on the 24-hour PSI. <a href="/#h-health">PSI health advice</a></p>
</section>

<section class="block" aria-labelledby="h-faq">
  <div class="block-head"><h2 id="h-faq">PM2.5 questions</h2></div>
  ${faqHtml(PM_FAQ)}
</section>`;
  return layout({
    path,
    title,
    description,
    body,
    bodyAttrs: `class="home pm-page"${pmSnap ? ` data-band="${pmKey(pmSnap.max)}"` : ""}`,
    scripts: liveScripts,
    jsonld: [
      { "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: SITE + path, dateModified: GENERATED, about: [{ "@type": "Thing", name: "PM2.5" }, { "@type": "Thing", name: "Air pollution in Singapore" }] },
      datasetLd(path),
      crumbs("PM2.5 live", path),
      faqLd(PM_FAQ),
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
    <p class="crumb"><a href="/">PSI live</a> <span aria-hidden="true">/</span> Singapore measures</p>
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
    <p class="crumb"><a href="/">PSI live</a> <span aria-hidden="true">/</span> Indonesia fires</p>
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
    <p class="crumb"><a href="/">PSI live</a> <span aria-hidden="true">/</span> Malaysia</p>
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
for (const f of ["live.json", "history.json", "updates.json", "daily.json"]) if (existsSync(join(ROOT, "data", f))) cpSync(join(ROOT, "data", f), join(DIST, "data", f));
writeFileSync(join(DIST, ".nojekyll"), "");

write("index.html", home());
write("pm25/index.html", pm25());
write("singapore-haze-policy/index.html", policy());
write("indonesia-forest-fires/index.html", indonesia());
write("malaysia-haze/index.html", malaysia());
write("404.html", notFound());

const lastmod = GENERATED.slice(0, 10);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => { const liveP = p.path === "/" || p.path === "/pm25/"; return `  <url><loc>${SITE}${p.path}</loc><lastmod>${liveP ? GENERATED.slice(0, 19) + "Z" : lastmod}</lastmod><changefreq>${liveP ? "hourly" : "daily"}</changefreq><priority>${p.path === "/" ? "1.0" : liveP ? "0.9" : "0.7"}</priority></url>`; }).join("\n")}
</urlset>
`
);
write(
  "llms.txt",
  `# SG Air Quality (sgairquality.com)

> Independent live tracker of Singapore's air quality: live 24-hour PSI and 1-hour PM2.5 for the North, South, East, West and Central regions (refreshed every 30 minutes from NEA), 24-hour PSI and PM2.5 trends, a haze forecast, a comparison of this haze season with last year, and a map of fire hotspots and smoke haze.

${psiSentence}
${pmSentence}
${live.advisory?.forecastBand ? `NEA 24-hour PSI forecast: ${live.advisory.forecastBand}.` : ""}
${yearSentence}

## Pages
- [Singapore PSI live](${SITE}/): live PSI and PM2.5 by region, 24-hour trends, haze forecast, this year vs last year, hotspot map, FAQ
- [Singapore PM2.5 live](${SITE}/pm25/): live 1-hour PM2.5 by region, 24-hour PM2.5 trend, NEA PM2.5 bands
- [Singapore haze measures](${SITE}/singapore-haze-policy/): Haze Task Force actions, N95 masks, MOE and MOM rules
- [Indonesia forest fires](${SITE}/indonesia-forest-fires/): hotspot map and counts by area, causes, El Niño
- [Malaysia haze](${SITE}/malaysia-haze/): API thresholds, school closures, Sarawak emergency

## Data (JSON)
- [live.json](${SITE}/data/live.json): PSI and PM2.5 snapshot, last 24 hours by region, NEA advisory, hotspots, haze areas, headlines (every 30 min)
- [daily.json](${SITE}/data/daily.json): daily peak 24-hour PSI and PM2.5 for the past year and the year before
- [history.json](${SITE}/data/history.json): daily NEA hotspot totals this season
`.replace(/\n{3,}/g, "\n\n")
);
console.log("built dist/ from data generated", GENERATED);

#!/usr/bin/env node
// Pulls the latest haze data into data/live.json (every run) and data/history.json (daily).
// Runs every 30 minutes in GitHub Actions. No AI, no database, no dependencies (Node 20+).
//
// Sources
//   NEA haze situation update  https://www.nea.gov.sg/api/advisory/latesthazesituationupdate/
//   NEA hotspots + haze areas  KML files linked from https://www.haze.gov.sg/
//   NEA PSI / PM2.5 readings   https://api-open.data.gov.sg/v2/real-time/api/{psi,pm25}
//   Headlines                  Google News RSS (title, publisher, time, link only)
//
// Usage: node scripts/update.mjs            normal run
//        node scripts/update.mjs --backfill  also fill daily PSI history back to SEASON_START

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "data/live.json");
const HISTORY = join(ROOT, "data/history.json");
const SITE = "https://sgairquality.com";
const SEASON_START = "2026-09-01";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const DGS = "https://api-open.data.gov.sg/v2/real-time/api";
const REGIONS = ["north", "south", "east", "west", "central"];
const BACKFILL = process.argv.includes("--backfill");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sgDate = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const log = (...a) => console.log("[update]", ...a);

async function get(url, as = "json", tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: as === "json" ? "application/json" : "*/*" }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) { await sleep(3000 * (i + 1)); throw new Error("HTTP 429"); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return as === "json" ? await r.json() : await r.text();
    } catch (e) {
      err = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`${url}: ${err?.message}`);
}

const decode = (s = "") =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&micro;/g, "µ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// ---------- NEA haze situation update ----------
async function neaAdvisory() {
  const j = await get("https://www.nea.gov.sg/api/advisory/latesthazesituationupdate/");
  const paras = decode(j.BodyText || "")
    .split(/\n+/)
    .map((p) => p.replace(/^\s*\d+\.\s*/, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40);
  const pick = (re) => paras.find((p) => re.test(p));
  const current = pick(/24-hr PSI (was|ranged|is)|1-hr PM2\.5/i) || paras[0] || "";
  const smoke = pick(/smoke|hotspot|haze .*observed/i);
  const forecast = pick(/forecast/i);
  return {
    issuedAt: j.DateOfArticle,
    forecastBand: decode(j.AirQualityBlurb || "").replace(/^24-hr PSI Forecast:\s*/i, "").trim(),
    paragraphs: [...new Set([current, smoke, forecast].filter(Boolean))],
    url: "https://www.haze.gov.sg/",
  };
}

// ---------- NEA hotspots and haze boundaries (KML) ----------
const KML_BBOX = { w: 90, e: 128, s: -11, n: 10 };
async function neaKml() {
  const html = await get("https://www.haze.gov.sg/", "text");
  const find = (dir) => {
    const m = html.match(new RegExp(`https://www\\.haze\\.gov\\.sg/docs/default-source/${dir}/[^"'?\\s]+\\.kml`, "i"));
    return m && m[0];
  };
  const out = {};

  const hsUrl = find("haze_hotspots");
  if (hsUrl) {
    const kml = await get(hsUrl, "text");
    const pts = [];
    for (const pm of kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || []) {
      const c = pm.match(/<coordinates>\s*([-\d.]+),([-\d.]+)/);
      if (!c) continue;
      const lon = +(+c[1]).toFixed(3), lat = +(+c[2]).toFixed(3);
      if (lon < KML_BBOX.w || lon > KML_BBOX.e || lat < KML_BBOX.s || lat > KML_BBOX.n) continue;
      const f = (n) => (pm.match(new RegExp(`name="${n}">([^<]*)<`)) || [])[1] || "";
      pts.push([lon, lat, f("region"), f("satellite"), f("time")]);
    }
    const byRegion = {};
    for (const p of pts) byRegion[p[2] || "Other"] = (byRegion[p[2] || "Other"] || 0) + 1;
    const stamp = (hsUrl.match(/(\d{8})_(\d{6})/) || []).slice(1);
    out.hotspots = {
      asOf: stamp.length ? `${stamp[0].slice(0, 4)}-${stamp[0].slice(4, 6)}-${stamp[0].slice(6, 8)}T${stamp[1].slice(0, 2)}:${stamp[1].slice(2, 4)}:00+08:00` : null,
      total: pts.length,
      byRegion: Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name: name === "SabahSarawak" ? "Sabah and Sarawak" : name, count })),
      points: pts, // [lon, lat, region, satellite, timeHHMM]
      source: "NEA / Meteorological Service Singapore",
      url: "https://www.haze.gov.sg/",
    };
  }

  const hbUrl = find("hazeboundaries");
  if (hbUrl) {
    const kml = await get(hbUrl, "text");
    const features = [];
    for (const pm of kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || []) {
      const name = (pm.match(/<name>([^<]*)<\/name>/) || [])[1] || "Haze";
      const coords = (pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/) || [])[1];
      if (!coords) continue;
      const ring = coords.trim().split(/\s+/).map((t) => t.split(",").slice(0, 2).map((v) => +(+v).toFixed(3)));
      if (ring.length < 4) continue;
      features.push({ type: "Feature", properties: { kind: /dense/i.test(name) ? "dense" : "moderate", name }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
    const stamp = (hbUrl.match(/(\d{8})_(\d{6})/) || []).slice(1);
    out.haze = {
      asOf: stamp.length ? `${stamp[0].slice(0, 4)}-${stamp[0].slice(4, 6)}-${stamp[0].slice(6, 8)}T${stamp[1].slice(0, 2)}:${stamp[1].slice(2, 4)}:00+08:00` : null,
      geojson: { type: "FeatureCollection", features },
    };
  }
  return out;
}

// ---------- headlines (Google News RSS) ----------
const FEEDS = {
  sg: '(singapore haze) OR (singapore PSI) OR (NEA haze) when:3d',
  id: '(indonesia forest fires) OR (indonesia haze) OR (sumatra fires) OR (kalimantan fires) when:3d',
  my: '(malaysia haze) OR (malaysia API haze) OR (sarawak haze) when:3d',
};
async function headlines() {
  const out = {};
  for (const [key, q] of Object.entries(FEEDS)) {
    try {
      const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-SG&gl=SG&ceid=SG:en`, "text");
      const seen = new Set();
      out[key] = (xml.match(/<item>[\s\S]*?<\/item>/g) || [])
        .map((it) => {
          const tag = (t) => decode((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "").trim();
          const source = tag("source");
          let title = tag("title");
          if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
          return { title, source, url: tag("link"), publishedAt: new Date(tag("pubDate")).toISOString() };
        })
        .filter((n) => n.title && n.url && !isNaN(Date.parse(n.publishedAt)))
        .filter((n) => { const k = n.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
        .slice(0, 8);
    } catch (e) {
      log("headlines", key, e.message);
    }
    await sleep(800);
  }
  return out;
}

// ---------- PSI / PM2.5 now and the last 24 hours, per region ----------
// Light on NEA's API: each run asks only for today's readings (one PSI and one PM2.5 call).
// Older rows come from the previous live.json; yesterday is fetched only if they are missing.
// trend rows: [epochMs, north, south, east, west, central]
async function dayItems(endpoint, date) {
  const items = [];
  let token = null;
  for (let i = 0; i < 6; i++) {
    const qs = new URLSearchParams(date ? { date } : {});
    if (token) qs.set("paginationToken", token);
    const j = await get(`${DGS}/${endpoint}${qs.toString() ? "?" + qs : ""}`);
    items.push(...((j.data && j.data.items) || []));
    token = j.data && j.data.paginationToken;
    if (!token) break;
    await sleep(800);
  }
  return items.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)); // dated queries come back newest first
}
const toRows = (items, key) =>
  items
    .map((it) => { const r = it.readings && it.readings[key]; return r ? [Date.parse(it.timestamp), ...REGIONS.map((k) => (typeof r[k] === "number" ? r[k] : null))] : null; })
    .filter(Boolean);

async function readings(prev) {
  const cutoff = Date.now() - 26 * 3600e3;
  const out = {};
  for (const [endpoint, key, name] of [["psi", "psi_twenty_four_hourly", "psi"], ["pm25", "pm25_one_hourly", "pm"]]) {
    let items = await dayItems(endpoint, sgDate(0));
    if (!items.length) { await sleep(800); items = await dayItems(endpoint); } // just after midnight: latest only
    const old = (prev.trend && prev.trend[name]) || [];
    let rows = toRows(items, key);
    const startToday = Date.parse(`${sgDate(0)}T00:00:00+08:00`);
    if (!old.some((r) => r[0] < startToday && r[0] >= cutoff)) {
      // no saved rows from yesterday (first run, or a gap): fetch yesterday once
      await sleep(800);
      try { rows = [...toRows(await dayItems(endpoint, sgDate(-1)), key), ...rows]; } catch (e) { log("readings", endpoint, "yesterday", e.message); }
    }
    const byT = new Map();
    for (const r of [...old, ...rows]) if (r[0] >= cutoff) byT.set(r[0], r);
    out[name] = { latest: items.at(-1), rows: [...byT.values()].sort((x, y) => x[0] - y[0]) };
    await sleep(800);
  }
  const p = out.psi.latest, q = out.pm.latest;
  if (!p) throw new Error("no PSI reading");
  return {
    now: {
      timestamp: p.timestamp,
      psi: p.readings.psi_twenty_four_hourly,
      pm25_24h: p.readings.pm25_twenty_four_hourly,
      pm10_24h: p.readings.pm10_twenty_four_hourly,
      o3_8h: p.readings.o3_eight_hour_max,
      pm25_1h: q ? q.readings.pm25_one_hourly : null,
      pm25_1h_timestamp: q ? q.timestamp : null,
    },
    trend: { psi: out.psi.rows, pm: out.pm.rows },
  };
}

// ---------- daily history ----------
async function dayMax(date) {
  const items = [];
  let token = null;
  for (let i = 0; i < 6; i++) {
    const qs = new URLSearchParams({ date });
    if (token) qs.set("paginationToken", token);
    const j = await get(`${DGS}/psi?${qs}`);
    items.push(...(j.data.items || []));
    token = j.data.paginationToken;
    if (!token) break;
  }
  if (!items.length) return null;
  const psi = {};
  for (const r of REGIONS) psi[r] = Math.max(...items.map((it) => it.readings.psi_twenty_four_hourly[r] ?? 0));
  return { date, max: Math.max(...Object.values(psi)), psi, hours: items.length };
}

async function updateHistory(live) {
  const hist = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : { psi: [], hotspots: [] };
  hist.psi ||= []; hist.hotspots ||= [];
  const have = new Set(hist.psi.map((d) => d.date));
  const yday = sgDate(-1);
  const want = [];
  if (BACKFILL) {
    for (let d = new Date(SEASON_START + "T12:00:00Z"); d.toISOString().slice(0, 10) <= yday; d = new Date(d.getTime() + 864e5)) {
      const k = d.toISOString().slice(0, 10);
      if (!have.has(k)) want.push(k);
    }
  } else if (!have.has(yday)) want.push(yday);
  for (const date of want) {
    try {
      const row = await dayMax(date);
      if (row) hist.psi.push(row);
      log("history", date, row?.max);
    } catch (e) { log("history", date, e.message); }
    await sleep(1200);
  }
  hist.psi.sort((a, b) => (a.date < b.date ? -1 : 1));

  const hs = live.hotspots;
  if (hs?.asOf) {
    const date = hs.asOf.slice(0, 10);
    if (!hist.hotspots.some((d) => d.date === date)) {
      const get = (n) => hs.byRegion.find((r) => r.name === n)?.count || 0;
      hist.hotspots.push({ date, total: hs.total, sumatra: get("Sumatra"), kalimantan: get("Kalimantan") });
      hist.hotspots.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  }
  hist.psi = hist.psi.slice(-400);
  hist.hotspots = hist.hotspots.slice(-400);
  return hist;
}

// ---------- main ----------
async function previous() {
  if (existsSync(LIVE)) { try { return JSON.parse(readFileSync(LIVE, "utf8")); } catch {} }
  try { return await get(`${SITE}/data/live.json`); } catch { return {}; }
}

const prev = await previous();
const live = { generatedAt: new Date().toISOString(), sources: {} };
async function weatherNow() {
  const j = await get(`${DGS}/twenty-four-hr-forecast`);
  const g = j.data && j.data.records && j.data.records[0] && j.data.records[0].general;
  if (!g) throw new Error("no forecast record");
  return g; // { forecast, wind: { direction, speed }, validPeriod, temperature, relativeHumidity }
}

const tasks = {
  advisory: neaAdvisory,
  kml: neaKml,
  headlines,
  readings: () => readings(prev),
  weather: weatherNow,
};
for (const [k, fn] of Object.entries(tasks)) {
  try {
    const v = await fn();
    if (k === "kml" || k === "readings") Object.assign(live, v);
    else live[k] = v;
    live.sources[k] = "ok";
  } catch (e) {
    live.sources[k] = `failed: ${e.message}`;
    log(k, "failed, keeping previous:", e.message);
    if (k === "kml") { if (prev.hotspots) live.hotspots = prev.hotspots; if (prev.haze) live.haze = prev.haze; }
    else if (k === "readings") { if (prev.now) live.now = prev.now; if (prev.trend) live.trend = prev.trend; }
    else if (prev[k]) live[k] = prev[k];
  }
}
// a failed sub-part of kml still falls back
if (!live.hotspots && prev.hotspots) live.hotspots = prev.hotspots;
if (!live.haze && prev.haze) live.haze = prev.haze;

mkdirSync(dirname(LIVE), { recursive: true });
writeFileSync(LIVE, JSON.stringify(live));
const hist = await updateHistory(live);
writeFileSync(HISTORY, JSON.stringify(hist, null, 1) + "\n");
log("sources", live.sources);
log("hotspots", live.hotspots?.total, "headlines", Object.fromEntries(Object.entries(live.headlines || {}).map(([k, v]) => [k, v.length])));

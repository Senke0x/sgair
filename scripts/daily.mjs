#!/usr/bin/env node
// Builds data/daily.json: each day's peak 24-hr PSI and peak 24-hr PM2.5 (highest region),
// for the past year and the year before it, so the site can compare this year with last year.
//   { days: { "YYYY-MM-DD": [psi, pm25] | null } }   (null = NEA has no data for that day)
//
// Light on NEA's API by design:
//   - one request per day (the PSI endpoint carries both PSI and PM2.5), two seconds apart
//   - every day is fetched once only; days NEA has no data for are recorded too
//   - at most --max days per run (default 12). The latest month and the same month last year
//     are filled first, then older days a few at a time, so the full year arrives over about
//     a day of scheduled runs. After that, a run fetches only yesterday: one request a day.
//
// Usage: node scripts/daily.mjs [--max 12]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/daily.json");
const DGS = "https://api-open.data.gov.sg/v2/real-time/api/psi";
const REGIONS = ["north", "south", "east", "west", "central"];
const argMax = process.argv.indexOf("--max");
const MAX = argMax > 0 ? Math.max(0, +process.argv[argMax + 1] || 0) : 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sgToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const lastYear = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`; // same calendar date a year earlier
const yday = addDays(sgToday, -1);

async function get(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) { await sleep(10000 * (i + 1)); throw new Error("HTTP 429"); }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; await sleep(3000 * (i + 1)); }
  }
  throw new Error(`${url}: ${err?.message}`);
}

const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { days: {} };
data.days ||= {};

// priority: the past 30 days and their last-year dates, then the rest of the year, newest first
const want = [];
for (let k = 0; k < 365; k++) {
  const d = addDays(yday, -k);
  want.push(d, lastYear(d));
}
const keep = new Set(want);
for (const d of Object.keys(data.days)) if (!keep.has(d)) delete data.days[d];
const todo = want.filter((d) => !(d in data.days)).slice(0, MAX);

let n = 0;
for (const date of todo) {
  try {
    if (n++) await sleep(2000);
    const j = await get(`${DGS}?date=${date}`); // a day of hourly readings fits in one page
    const items = (j && j.data && j.data.items) || [];
    const peak = (key) => {
      const v = items.flatMap((it) => REGIONS.map((r) => it.readings?.[key]?.[r])).filter((x) => typeof x === "number");
      return v.length ? Math.max(...v) : null;
    };
    const psi = peak("psi_twenty_four_hourly"), pm = peak("pm25_twenty_four_hourly");
    data.days[date] = psi == null ? null : [psi, pm];
    console.log("[daily]", date, psi ?? "no data", pm ?? "");
  } catch (e) {
    console.log("[daily]", date, e.message, "(will retry on a later run)");
  }
}
data.days = Object.fromEntries(Object.entries(data.days).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(OUT, JSON.stringify(data) + "\n");
const missing = want.filter((d) => !(d in data.days)).length;
console.log(`[daily] ${n} requests this run, ${want.length - missing}/${want.length} days stored`);

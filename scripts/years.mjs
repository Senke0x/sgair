#!/usr/bin/env node
// Builds data/lastyear.json: last year's daily peak 24-hr PSI for the haze-season window
// (1 Sep – 31 Oct), so the site can compare this year with last year.
// This year's numbers come from data/history.json, which the site already collects.
//
// Light on NEA's API by design: one request per missing day, two seconds apart, and every
// day is fetched once only (days with no data are recorded too). Once the file is complete,
// a run makes no requests at all. On 1 Jan it fills the year that just ended, once.
//
// Usage: node scripts/years.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/lastyear.json");
const DGS = "https://api-open.data.gov.sg/v2/real-time/api/psi";
const FROM = "09-01", TO = "10-31";
const REGIONS = ["north", "south", "east", "west", "central"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const year = new Date(Date.now() + 8 * 3600e3).getUTCFullYear() - 1;
let data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
if (!data || data.year !== year) data = { year, window: { from: FROM, to: TO }, days: [] };
const have = new Set(data.days.map((r) => r.d));
let requests = 0;

for (let t = Date.parse(`${year}-${FROM}T12:00:00Z`); t <= Date.parse(`${year}-${TO}T12:00:00Z`); t += 864e5) {
  const date = new Date(t).toISOString().slice(0, 10);
  if (have.has(date.slice(5))) continue;
  try {
    requests++;
    const j = await get(`${DGS}?date=${date}`); // one day of hourly readings fits in one page
    const items = (j && j.data && j.data.items) || [];
    const vals = items.flatMap((it) => REGIONS.map((r) => it.readings?.psi_twenty_four_hourly?.[r])).filter((x) => typeof x === "number");
    data.days.push({ d: date.slice(5), psi: vals.length ? Math.max(...vals) : null });
    console.log("[lastyear]", date, vals.length ? Math.max(...vals) : "no data");
  } catch (e) {
    console.log("[lastyear]", date, e.message, "(will retry on a later run)");
  }
  await sleep(2000);
}
data.days.sort((a, b) => (a.d < b.d ? -1 : 1));
writeFileSync(OUT, JSON.stringify(data) + "\n");
console.log(`[lastyear] ${year}: ${data.days.length} days, ${requests} requests this run`);

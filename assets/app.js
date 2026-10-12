/* sgairquality.com live data. No build step, no dependencies.
 * Sources:
 *  - NEA via data.gov.sg real-time API (PSI, PM2.5, 24-hr weather forecast)
 *  - Open-Meteo air-quality API (CAMS global model) for the PM2.5 forecast
 * Refreshes every 30 minutes. */
(() => {
  "use strict";

  const API = "https://api-open.data.gov.sg/v2/real-time/api";
  const OM =
    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=1.3521&longitude=103.8198&hourly=pm2_5&past_days=2&forecast_days=4&timezone=Asia%2FSingapore";
  const REFRESH_MS = 30 * 60 * 1000;
  const REGIONS = ["north", "south", "east", "west", "central"];
  const REGION_NAME = { north: "North", south: "South", east: "East", west: "West", central: "Central" };
  const HIST_KEY = "sgaq-psi-history-v1";

  const $ = (sel) => document.querySelector(sel);
  const state = { lastLoad: 0, yesterday: { date: null, items: [] }, loading: false };

  // ---------- scales ----------
  const BANDS = [
    { key: "good", max: 50, label: "Good" },
    { key: "moderate", max: 100, label: "Moderate" },
    { key: "unhealthy", max: 200, label: "Unhealthy" },
    { key: "very", max: 300, label: "Very unhealthy" },
    { key: "hazardous", max: Infinity, label: "Hazardous" },
  ];
  const bandOf = (psi) => BANDS.find((b) => psi <= b.max);

  const ADVICE = {
    good: "Air quality is good. Carry on with normal activities.",
    moderate: "Air quality is moderate. Normal activities are fine for everyone.",
    unhealthy:
      "Healthy people should cut down on long or strenuous outdoor activity. Children, the elderly and pregnant women should keep it to a minimum, and people with heart or lung conditions should avoid it.",
    very:
      "Everyone should avoid long or strenuous outdoor activity. Children, the elderly and pregnant women should stay indoors as much as possible, and people with heart or lung conditions should avoid going outdoors.",
    hazardous:
      "Healthy people should keep outdoor activity to a minimum. Children, the elderly, pregnant women and people with heart or lung conditions should avoid going outdoors.",
  };

  function pmBand(v) {
    if (v <= 55) return "Band I Normal";
    if (v <= 150) return "Band II Elevated";
    if (v <= 250) return "Band III High";
    return "Band IV Very high";
  }

  // NEA PSI sub-index for 24-hr PM2.5 (µg/m³)
  const PM25_BP = [
    [0, 12, 0, 50],
    [12, 55, 50, 100],
    [55, 150, 100, 200],
    [150, 250, 200, 300],
    [250, 350, 300, 400],
    [350, 500, 400, 500],
  ];
  function pm25ToPsi(c) {
    if (c == null || !isFinite(c)) return null;
    for (const [cl, ch, il, ih] of PM25_BP) {
      if (c <= ch) return Math.round(il + ((c - cl) * (ih - il)) / (ch - cl));
    }
    return 500;
  }

  // ---------- time helpers (all display in Singapore time) ----------
  const SGT = "Asia/Singapore";
  function sgDate(offsetDays = 0) {
    const d = new Date(Date.now() + 8 * 3600e3 + offsetDays * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const fmtTime = (d) =>
    d.toLocaleString("en-SG", { timeZone: SGT, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
  const fmtDay = (d) => d.toLocaleDateString("en-SG", { timeZone: SGT, weekday: "short", day: "numeric", month: "short" });
  const sgYmd = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

  // ---------- fetching ----------
  async function getJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchItems(endpoint, date) {
    const items = [];
    let token = null;
    for (let page = 0; page < 6; page++) {
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (token) qs.set("paginationToken", token);
      const j = await getJSON(`${API}/${endpoint}${qs.toString() ? "?" + qs : ""}`);
      const d = j && j.data;
      if (!d) break;
      items.push(...(d.items || []));
      token = d.paginationToken;
      if (!token) break;
    }
    return items;
  }

  const maxPsi = (item) => {
    const r = item.readings && item.readings.psi_twenty_four_hourly;
    if (!r) return null;
    const vals = REGIONS.map((k) => r[k]).filter((v) => typeof v === "number");
    return vals.length ? Math.max(...vals) : null;
  };

  // Keep a small local history so the trend line still works if the API only returns the latest reading.
  function readHist() {
    try {
      return JSON.parse(localStorage.getItem(HIST_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function writeHist(points) {
    try {
      const h = readHist();
      for (const p of points) h[p.t] = p.v;
      const cutoff = Date.now() - 72 * 3600e3;
      for (const k of Object.keys(h)) if (+k < cutoff) delete h[k];
      localStorage.setItem(HIST_KEY, JSON.stringify(h));
    } catch {
      /* storage unavailable: fine */
    }
  }

  async function loadPsi() {
    const today = sgDate(0);
    const yday = sgDate(-1);
    let todayItems = [];
    try {
      todayItems = await fetchItems("psi", today);
    } catch (e) {
      todayItems = [];
    }
    if (!todayItems.length) todayItems = await fetchItems("psi"); // latest only
    if (state.yesterday.date !== yday) {
      try {
        state.yesterday = { date: yday, items: await fetchItems("psi", yday) };
      } catch {
        state.yesterday = { date: yday, items: [] };
      }
    }
    const all = [...state.yesterday.items, ...todayItems];
    const seen = new Map();
    for (const it of all) seen.set(it.timestamp, it);
    const items = [...seen.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    const points = items
      .map((it) => ({ t: Date.parse(it.timestamp), v: maxPsi(it) }))
      .filter((p) => p.v != null);
    writeHist(points);
    const hist = readHist();
    const merged = Object.keys(hist)
      .map((k) => ({ t: +k, v: hist[k] }))
      .sort((a, b) => a.t - b.t);
    return { latest: items[items.length - 1], series: merged };
  }

  // ---------- rendering ----------
  function renderNow(psiItem, pmItem) {
    const r = psiItem.readings;
    const psi = r.psi_twenty_four_hourly;
    const max = maxPsi(psiItem);
    const b = bandOf(max);
    const vals = REGIONS.map((k) => psi[k]);
    const min = Math.min(...vals);
    const hot = REGIONS.filter((k) => psi[k] === max).map((k) => REGION_NAME[k]);

    document.body.dataset.band = b.key;
    document.body.style.setProperty("--haze", Math.max(0, Math.min(0.85, (max - 50) / 280)).toFixed(2));

    $("#psi-max").textContent = max;
    $("#psi-band").textContent = b.label;
    $("#psi-advice").textContent = ADVICE[b.key];
    const ts = new Date(psiItem.timestamp);
    $("#psi-time").textContent = `${hot.join(" and ")} highest. Island range ${min}–${max}. NEA reading for ${fmtTime(ts)}.`;

    const pm = pmItem && pmItem.readings && pmItem.readings.pm25_one_hourly;
    for (const k of REGIONS) {
      const el = document.querySelector(`.reg[data-region="${k}"]`);
      if (!el) continue;
      el.dataset.band = bandOf(psi[k]).key;
      el.querySelector(".reg-psi").textContent = psi[k];
      el.querySelector(".reg-pm").textContent = pm && pm[k] != null ? `PM2.5 ${pm[k]}` : "PM2.5 –";
      el.setAttribute("aria-label", `${REGION_NAME[k]}: PSI ${psi[k]}, ${bandOf(psi[k]).label}`);
    }

    const rows = REGIONS.slice()
      .sort((a, b2) => psi[b2] - psi[a])
      .map((k) => {
        const bb = bandOf(psi[k]);
        const p1 = pm && pm[k];
        return `<tr>
          <th scope="row">${REGION_NAME[k]}</th>
          <td><span class="pill ${bb.key}">${psi[k]}</span> <span class="pm-tag">${bb.label}</span></td>
          <td>${p1 != null ? `${p1}<span class="pm-tag">${pmBand(p1)}</span>` : "–"}</td>
          <td>${r.pm25_twenty_four_hourly?.[k] ?? "–"}</td>
          <td>${r.pm10_twenty_four_hourly?.[k] ?? "–"}</td>
          <td>${r.o3_eight_hour_max?.[k] ?? "–"}</td>
        </tr>`;
      })
      .join("");
    $("#readings tbody").innerHTML = rows;
    document.dispatchEvent(new CustomEvent("sgaq:psi", { detail: psi }));
  }

  function renderError(msg) {
    $("#psi-band").textContent = "Readings unavailable";
    $("#psi-advice").innerHTML = `${msg} We'll try again automatically. Meanwhile, see <a href="https://www.haze.gov.sg/">haze.gov.sg</a>.`;
    $("#psi-time").textContent = "No data yet";
    $("#readings tbody").innerHTML = `<tr><td colspan="6" class="muted">${msg}</td></tr>`;
  }

  // ---------- forecast ----------
  function buildForecast(om, latestPsiItem) {
    if (!om || !om.hourly) return null;
    const t = om.hourly.time.map((s) => Date.parse(s + ":00+08:00"));
    const pm = om.hourly.pm2_5;
    const roll = pm.map((_, i) => {
      if (i < 23) return null;
      let s = 0, n = 0;
      for (let j = i - 23; j <= i; j++) if (pm[j] != null) { s += pm[j]; n++; }
      return n >= 18 ? s / n : null;
    });

    // scale the model to match NEA's latest observed 24-hr PM2.5 (highest region)
    let ratio = 1;
    if (latestPsiItem) {
      const obs = latestPsiItem.readings.pm25_twenty_four_hourly;
      const obsMax = obs ? Math.max(...REGIONS.map((k) => obs[k]).filter((v) => typeof v === "number")) : null;
      const obsT = Date.parse(latestPsiItem.timestamp);
      const idx = t.findIndex((x) => x >= obsT);
      const model = idx >= 0 ? roll[idx] : null;
      if (obsMax && model) ratio = Math.min(4, Math.max(0.5, obsMax / model));
    }

    const now = Date.now();
    const series = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] < now - 3600e3 || roll[i] == null) continue;
      series.push({ t: t[i], v: pm25ToPsi(roll[i] * ratio) });
    }
    return { series, ratio };
  }

  function renderForecastDays(fc) {
    const box = $("#forecast-days");
    if (!fc || !fc.series.length) {
      box.innerHTML = `<li class="muted">The forecast model didn't respond. Check NEA's outlook alongside.</li>`;
      return;
    }
    const byDay = new Map();
    for (const p of fc.series) {
      const k = sgYmd(new Date(p.t));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(p.v);
    }
    const today = sgDate(0);
    const days = [...byDay.entries()].slice(0, 4);
    box.innerHTML = days
      .map(([k, vals]) => {
        const hi = Math.max(...vals), lo = Math.min(...vals);
        const b = bandOf(hi);
        const name = k === today ? "Rest of today" : fmtDay(new Date(k + "T12:00:00+08:00"));
        return `<li class="day" data-band="${b.key}">
          <span class="day-name">${name}</span>
          <span class="day-psi">${hi}</span>
          <span class="day-band">${b.label}, range ${lo}–${hi}</span>
        </li>`;
      })
      .join("");
    $("#forecast-note").textContent =
      `Estimated peak 24-hour PSI. CAMS model PM2.5 via Open-Meteo, scaled ×${fc.ratio.toFixed(2)} to match NEA's latest readings. Not an official forecast.`;
  }

  // ---------- chart ----------
  function renderChart(obs, fc) {
    const fig = $("#chart");
    const now = Date.now();
    const x0 = now - 24 * 3600e3;
    const x1 = now + 72 * 3600e3;
    const o = obs.filter((p) => p.t >= x0);
    const f = fc ? fc.series.filter((p) => p.t <= x1) : [];
    if (!o.length && !f.length) {
      fig.innerHTML = `<div class="chart-empty muted">No readings to chart yet.</div>`;
      return;
    }
    const W = 900, H = 300, L = 40, R = 12, T = 12, B = 34;
    const peak = Math.max(120, ...o.map((p) => p.v), ...f.map((p) => p.v));
    const yMax = Math.ceil((peak + 20) / 50) * 50;
    const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => T + (1 - v / yMax) * (H - T - B);

    const bandDefs = [
      [0, 50, "good", "Good"],
      [50, 100, "moderate", "Moderate"],
      [100, 200, "unhealthy", "Unhealthy"],
      [200, 300, "very", "Very unhealthy"],
      [300, 500, "hazardous", "Hazardous"],
    ];
    const bands = bandDefs
      .filter(([lo]) => lo < yMax)
      .map(([lo, hi, k, label]) => {
        const top = Y(Math.min(hi, yMax)), bot = Y(lo);
        return `<rect class="band-${k}" x="${L}" y="${top}" width="${W - L - R}" height="${bot - top}"/>
          <text x="${W - R - 6}" y="${top + 13}" text-anchor="end">${label}</text>`;
      })
      .join("");

    const grid = [];
    for (let v = 0; v <= yMax; v += 50) {
      grid.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>`);
    }
    const yLabels = [];
    for (let v = 0; v <= yMax; v += 50) yLabels.push(`<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`);

    const xLabels = [];
    const start = new Date(sgDate(-1) + "T00:00:00+08:00").getTime();
    for (let d = start; d <= x1; d += 864e5) {
      for (const hOff of [0, 12]) {
        const tt = d + hOff * 3600e3;
        if (tt < x0 || tt > x1) continue;
        const lbl = hOff === 0 ? fmtDay(new Date(tt)) : "12pm";
        xLabels.push(`<text x="${X(tt)}" y="${H - 12}" text-anchor="middle">${lbl}</text>`);
        grid.push(`<line x1="${X(tt)}" x2="${X(tt)}" y1="${T}" y2="${H - B}" opacity="${hOff ? 0.4 : 1}"/>`);
      }
    }

    const path = (pts) =>
      pts.map((p, i) => `${i ? "L" : "M"}${X(Math.max(x0, p.t)).toFixed(1)} ${Y(Math.min(p.v, yMax)).toFixed(1)}`).join(" ");
    const lastObs = o[o.length - 1];
    const fcPts = f.filter((p) => !lastObs || p.t >= lastObs.t);
    if (lastObs && fcPts.length) fcPts.unshift(lastObs);

    const desc =
      `Highest regional 24-hour PSI: ${lastObs ? `latest ${lastObs.v}` : "no recent reading"}` +
      (f.length ? `, model estimate peaking at ${Math.max(...f.map((p) => p.v))} in the next 3 days.` : ".");

    fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${desc}">
      <g class="bands">${bands}</g>
      <g class="grid">${grid.join("")}</g>
      <g class="axis">${yLabels.join("")}${xLabels.join("")}</g>
      ${o.length ? `<path class="obs" d="${path(o)}"/>` : ""}
      ${fcPts.length ? `<path class="fc" d="${path(fcPts)}"/>` : ""}
      <g class="now"><line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}"/><text x="${X(now) + 4}" y="${T + 24}">Now</text></g>
    </svg>
    <figcaption>${desc} Times in Singapore time.</figcaption>`;
  }

  // ---------- wind ----------
  const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function renderWind(j) {
    const box = $("#wind");
    const rec = j && j.data && j.data.records && j.data.records[0];
    const g = rec && rec.general;
    if (!g || !g.wind) {
      box.innerHTML = `<h3>Wind for the next 24 hours</h3><p class="muted">The NEA weather forecast is unavailable right now.</p>`;
      return;
    }
    const dir = String(g.wind.direction || "").toUpperCase();
    const i = DIRS.indexOf(dir);
    const from = i >= 0 ? i * 22.5 : null;
    const southerly = from != null && from >= 101.25 && from <= 258.75; // ESE through WSW
    const arrow =
      from == null
        ? ""
        : `<svg class="wind-arrow" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25"/><g transform="rotate(${from + 180} 27 27)"><path d="M27 7l9 16h-6v20h-6V23h-6z"/></g></svg>`;
    const sp = g.wind.speed || {};
    box.innerHTML = `<h3>Wind for the next 24 hours</h3>
      <div class="wind-row">${arrow}<p><strong>${dir || "Variable"}</strong> winds, ${sp.low ?? "?"}–${sp.high ?? "?"} km/h. ${g.forecast?.text ? `${g.forecast.text}.` : ""}</p></div>
      <p class="meta">${
        southerly
          ? "Winds from the south and south-east can carry smoke from fires in Sumatra and Kalimantan towards Singapore."
          : from != null
          ? "Winds from this direction are less likely to bring smoke from the Indonesian fires."
          : ""
      } NEA forecast for ${g.validPeriod?.text || "the next 24 hours"}.</p>`;
  }

  // ---------- main loop ----------
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    const btn = $("#refresh");
    if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }

    const [psiRes, pmRes, windRes, omRes] = await Promise.allSettled([
      loadPsi(),
      fetchItems("pm25"),
      getJSON(`${API}/twenty-four-hr-forecast`),
      getJSON(OM),
    ]);

    let latest = null, series = [];
    if (psiRes.status === "fulfilled" && psiRes.value.latest) {
      latest = psiRes.value.latest;
      series = psiRes.value.series;
      const pmItems = pmRes.status === "fulfilled" ? pmRes.value : [];
      renderNow(latest, pmItems[pmItems.length - 1]);
    } else {
      renderError("data.gov.sg didn't return PSI readings.");
    }

    const fc = omRes.status === "fulfilled" ? buildForecast(omRes.value, latest) : null;
    renderForecastDays(fc);
    renderChart(series, fc);
    renderWind(windRes.status === "fulfilled" ? windRes.value : null);

    state.lastLoad = Date.now();
    state.loading = false;
    if (btn) { btn.disabled = false; btn.textContent = "Refresh now"; }
    tick();
  }

  function tick() {
    const el = $("#next-refresh");
    if (!el || !state.lastLoad) return;
    const mins = Math.max(0, Math.ceil((state.lastLoad + REFRESH_MS - Date.now()) / 60000));
    el.textContent = `Next check in ${mins} min`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    setInterval(() => {
      if (Date.now() - state.lastLoad >= REFRESH_MS) refresh();
      else tick();
    }, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - state.lastLoad >= REFRESH_MS) refresh();
    });
    const btn = $("#refresh");
    if (btn) btn.addEventListener("click", refresh);
  });
})();

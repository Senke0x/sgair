/* sgairquality.com live data. No build step, no dependencies.
 * Sources:
 *  - NEA readings (24-hr PSI, 1-hr PM2.5, wind) from /data/live.json, which the site's
 *    scheduled job copies from data.gov.sg every 30 minutes (data.gov.sg directly only as a fallback)
 *  - Open-Meteo air-quality API (CAMS global model) for the 3-day PSI estimate
 * Refreshes every 30 minutes. Works on any page: every element is optional. */
(() => {
  "use strict";

  const API = "https://api-open.data.gov.sg/v2/real-time/api";
  const OM =
    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=1.3521&longitude=103.8198&hourly=pm2_5&past_days=2&forecast_days=4&timezone=Asia%2FSingapore";
  const REFRESH_MS = 30 * 60 * 1000;
  const REGIONS = ["north", "south", "east", "west", "central"];
  const REGION_NAME = { north: "North", south: "South", east: "East", west: "West", central: "Central" };
  const REGION_KEY = "sgaq-trend-region";

  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  const state = { lastLoad: 0, loading: false, cache: {}, rows: { psi: [], pm: [] }, region: "max" };
  try { state.region = localStorage.getItem(REGION_KEY) || "max"; } catch { /* storage blocked: fine */ }

  // ---------- scales ----------
  const BANDS = [
    { key: "good", max: 50, label: "Good" },
    { key: "moderate", max: 100, label: "Moderate" },
    { key: "unhealthy", max: 200, label: "Unhealthy" },
    { key: "very", max: 300, label: "Very unhealthy" },
    { key: "hazardous", max: Infinity, label: "Hazardous" },
  ];
  const bandOf = (psi) => BANDS.find((b) => psi <= b.max);
  const PM_BANDS = [
    { key: "good", max: 55, label: "Band I Normal" },
    { key: "unhealthy", max: 150, label: "Band II Elevated" },
    { key: "very", max: 250, label: "Band III High" },
    { key: "hazardous", max: Infinity, label: "Band IV Very high" },
  ];
  const pmBandOf = (v) => PM_BANDS.find((b) => v <= b.max);

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
  const PM_ADVICE = {
    good: "PM2.5 is in the normal band this hour. Outdoor plans are fine.",
    unhealthy: "PM2.5 is elevated this hour. Consider a shorter or easier session outdoors, especially if you are sensitive to haze.",
    very: "PM2.5 is high this hour. Move strenuous activity indoors, and sensitive groups should stay inside.",
    hazardous: "PM2.5 is very high this hour. Stay indoors with windows closed and an air purifier on if you have one.",
  };

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
  const sgDate = (offsetDays = 0) => new Date(Date.now() + 8 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
  const fmtTime = (d) => d.toLocaleString("en-SG", { timeZone: SGT, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
  const fmtDay = (d) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-SG", { timeZone: SGT, weekday: "short", day: "numeric", month: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.day} ${p.month}`;
  };
  const fmtClock = (d) => d.toLocaleTimeString("en-SG", { timeZone: SGT, hour: "numeric", minute: "2-digit" });
  const sgYmd = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

  // ---------- fetching ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // data.gov.sg rate-limits anonymous callers, so back off and retry on 429 / 5xx.
  async function getJSON(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (r.ok) return await r.json();
        if (!(r.status === 429 || r.status >= 500) || i === tries - 1) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        if (i === tries - 1) throw e;
      } finally {
        clearTimeout(t);
      }
      await wait(1500 * (i + 1) + Math.random() * 500);
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

  const maxOf = (obj) => {
    const v = obj ? REGIONS.map((k) => obj[k]).filter((x) => typeof x === "number") : [];
    return v.length ? Math.max(...v) : null;
  };

  // ---------- rendering ----------
  function renderNow(psiItem, pmItem) {
    const r = psiItem.readings;
    const psi = r.psi_twenty_four_hourly;
    const max = maxOf(psi);
    const b = bandOf(max);
    const min = Math.min(...REGIONS.map((k) => psi[k]).filter((v) => typeof v === "number"));
    const hot = REGIONS.filter((k) => psi[k] === max).map((k) => REGION_NAME[k]);
    const pm = pmItem && pmItem.readings && pmItem.readings.pm25_one_hourly;
    const pmMax = maxOf(pm);
    const pb = pmMax != null ? pmBandOf(pmMax) : null;
    const isPm = document.body.classList.contains("pm-page");

    document.body.dataset.band = isPm && pb ? pb.key : b.key;
    document.body.style.setProperty("--haze", Math.max(0, Math.min(0.85, (max - 50) / 280)).toFixed(2));

    setText("#psi-max", max);
    setText("#psi-band", b.label);
    const psiBand = $("#psi-band"); if (psiBand) psiBand.dataset.band = b.key;
    if (pmMax != null) {
      setText("#pm-max", pmMax);
      setText("#pm-band", pb.label);
      const pmBandEl = $("#pm-band"); if (pmBandEl) pmBandEl.dataset.band = pb.key;
      setText("#pm-advice", PM_ADVICE[pb.key]);
    }
    setText("#psi-advice", ADVICE[b.key]);
    const ts = new Date(psiItem.timestamp);
    setText("#psi-time", isPm && pmItem
      ? `Highest 1-hr PM2.5 in ${REGIONS.filter((k) => pm[k] === pmMax).map((k) => REGION_NAME[k]).join(" and ")}. NEA reading for ${fmtTime(new Date(pmItem.timestamp))}.`
      : `${hot.join(" and ")} highest. Island range ${min}–${max}. NEA reading for ${fmtTime(ts)}.`);

    for (const k of REGIONS) {
      const el = document.querySelector(`.reg[data-region="${k}"]`);
      if (!el) continue;
      const pv = pm && pm[k];
      if (isPm) {
        el.dataset.band = pv != null ? pmBandOf(pv).key : "";
        el.querySelector(".reg-psi").textContent = pv ?? "–";
        el.querySelector(".reg-pm").textContent = `PSI ${psi[k]}`;
        el.setAttribute("aria-label", `${REGION_NAME[k]}: 1-hr PM2.5 ${pv ?? "not available"}, PSI ${psi[k]}`);
      } else {
        el.dataset.band = bandOf(psi[k]).key;
        el.querySelector(".reg-psi").textContent = psi[k];
        el.querySelector(".reg-pm").textContent = pv != null ? `PM2.5 ${pv}` : "PM2.5 –";
        el.setAttribute("aria-label", `${REGION_NAME[k]}: PSI ${psi[k]}, ${bandOf(psi[k]).label}, 1-hr PM2.5 ${pv ?? "not available"}`);
      }
    }

    const tbody = $("#readings tbody");
    if (tbody) {
      tbody.innerHTML = REGIONS.slice()
        .sort((a, b2) => psi[b2] - psi[a])
        .map((k) => {
          const bb = bandOf(psi[k]);
          const p1 = pm && pm[k];
          const pp = p1 != null ? pmBandOf(p1) : null;
          return `<tr>
          <th scope="row">${REGION_NAME[k]}</th>
          <td><span class="pill ${bb.key}">${psi[k]}</span> <span class="pm-tag">${bb.label}</span></td>
          <td>${p1 != null ? `<span class="pill ${pp.key}">${p1}</span> <span class="pm-tag">${pp.label}</span>` : "–"}</td>
          <td>${r.pm25_twenty_four_hourly?.[k] ?? "–"}</td>
          <td>${r.pm10_twenty_four_hourly?.[k] ?? "–"}</td>
          <td>${r.o3_eight_hour_max?.[k] ?? "–"}</td>
        </tr>`;
        })
        .join("");
    }
    document.dispatchEvent(new CustomEvent("sgaq:psi", { detail: psi }));
  }

  function renderError(msg) {
    setText("#psi-band", "Readings unavailable");
    const adv = $("#psi-advice");
    if (adv) adv.innerHTML = `${msg} We'll try again automatically. Meanwhile, see <a href="https://www.haze.gov.sg/">haze.gov.sg</a>.`;
    setText("#psi-time", "No data yet");
  }

  // ---------- 24-hour trends ----------
  function renderTrends() {
    const C = window.sgaqCharts;
    if (!C) return;
    for (const [kind, sel] of [["psi", "#chart-psi"], ["pm", "#chart-pm"]]) {
      const fig = $(sel);
      if (fig && state.rows[kind].length) fig.innerHTML = C.svg(kind, state.rows[kind], state.region);
    }
    document.querySelectorAll(".trend-tools [data-region]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === state.region)));
  }
  function bindRegionChips() {
    const tools = $(".trend-tools");
    if (!tools) return;
    tools.addEventListener("click", (e) => {
      const b = e.target.closest("[data-region]");
      if (!b) return;
      state.region = b.dataset.region;
      try { localStorage.setItem(REGION_KEY, state.region); } catch { /* fine */ }
      renderTrends();
    });
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
      const obsMax = maxOf(latestPsiItem.readings.pm25_twenty_four_hourly);
      const idx = t.findIndex((x) => x >= Date.parse(latestPsiItem.timestamp));
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
    if (!box) return;
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
    box.innerHTML = [...byDay.entries()]
      .slice(0, 4)
      .map(([k, vals]) => {
        const hi = Math.max(...vals), lo = Math.min(...vals);
        const b = bandOf(hi);
        const name = k === today ? "Today" : fmtDay(new Date(k + "T12:00:00+08:00"));
        return `<li class="day" data-band="${b.key}">
          <span class="day-name">${name}</span>
          <span class="day-psi">${hi}</span>
          <span class="day-band">${b.label}</span>
          <span class="day-range">Range ${lo}–${hi}</span>
        </li>`;
      })
      .join("");
    setText("#forecast-note", `Estimated peak 24-hour PSI. CAMS model PM2.5 via Open-Meteo, scaled ×${fc.ratio.toFixed(2)} to match NEA's latest readings. Not an official forecast.`);
  }

  // ---------- wind ----------
  const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function renderWind(j) {
    const box = $("#wind");
    if (!box) return;
    const rec = j && j.data && j.data.records && j.data.records[0];
    const g = (rec && rec.general) || (j && j.wind ? j : null);
    if (!g || !g.wind) {
      box.innerHTML = `<h3>Wind for the next 24 hours</h3><p class="muted">The NEA weather forecast is unavailable right now.</p>`;
      return;
    }
    const dir = String(g.wind.direction || "").toUpperCase();
    const i = DIRS.indexOf(dir);
    const from = i >= 0 ? i * 22.5 : null;
    const southerly = from != null && from >= 101.25 && from <= 258.75; // ESE through WSW
    const arrow = from == null ? "" : `<svg class="wind-arrow" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25"/><g transform="rotate(${from + 180} 27 27)"><path d="M27 7l9 16h-6v20h-6V23h-6z"/></g></svg>`;
    const sp = g.wind.speed || {};
    box.innerHTML = `<h3>Wind for the next 24 hours</h3>
      <div class="wind-row">${arrow}<p><strong>${dir || "Variable"}</strong> winds, ${sp.low ?? "?"}–${sp.high ?? "?"} km/h. ${g.forecast?.text ? `${g.forecast.text}.` : ""}</p></div>
      <p class="meta">${southerly ? "Winds from the south and south-east can carry smoke from fires in Sumatra and Kalimantan towards Singapore." : from != null ? "Winds from this direction are less likely to bring smoke from the Indonesian fires." : ""} NEA forecast for ${g.validPeriod?.text || "the next 24 hours"}.</p>`;
  }

  // ---------- main loop ----------
  const settle = (p) => p.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));

  // The site's scheduled job saves NEA's readings to /data/live.json every 30 minutes, so
  // visitors read that copy and never call data.gov.sg themselves. Only if the copy is more
  // than 90 minutes old do we ask NEA directly, for the latest reading only.
  const STALE_MS = 90 * 60 * 1000;
  const asItems = (n) => ({
    psi: { timestamp: n.timestamp, readings: { psi_twenty_four_hourly: n.psi, pm25_twenty_four_hourly: n.pm25_24h, pm10_twenty_four_hourly: n.pm10_24h, o3_eight_hour_max: n.o3_8h } },
    pm: n.pm25_1h ? { timestamp: n.pm25_1h_timestamp || n.timestamp, readings: { pm25_one_hourly: n.pm25_1h } } : null,
  });

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    const wantForecast = !!$("#forecast-days");
    const omP = wantForecast ? settle(getJSON(OM)) : Promise.resolve(null);

    const j = window.sgaqLive ? await window.sgaqLive.refresh() : null;
    let psiItem = null, pmItem = null;
    if (j && j.now && Date.now() - Date.parse(j.now.timestamp) < STALE_MS) {
      ({ psi: psiItem, pm: pmItem } = asItems(j.now));
    } else {
      const psiRes = await settle(fetchItems("psi"));
      const pmRes = await settle(fetchItems("pm25"));
      psiItem = psiRes.status === "fulfilled" ? psiRes.value.at(-1) : null;
      pmItem = pmRes.status === "fulfilled" ? pmRes.value.at(-1) : null;
      if (!psiItem && j && j.now) ({ psi: psiItem, pm: pmItem } = asItems(j.now)); // old, but better than nothing
    }
    if (psiItem) renderNow(psiItem, pmItem);
    else renderError("NEA readings are not available right now.");

    if (j && j.trend) {
      if (j.trend.psi && j.trend.psi.length) state.rows.psi = j.trend.psi;
      if (j.trend.pm && j.trend.pm.length) state.rows.pm = j.trend.pm;
    }
    renderTrends();

    if (wantForecast) {
      const omRes = await omP;
      renderForecastDays(omRes && omRes.status === "fulfilled" ? buildForecast(omRes.value, psiItem) : null);
    }
    renderWind(j && j.weather ? j.weather : null);

    state.lastLoad = Date.now();
    state.loading = false;
    setText("#last-refresh", `Last refreshed ${fmtClock(new Date(state.lastLoad))}`);
  }

  // this year vs last year: 1 month / 1 year switch (both views are baked into the page)
  function bindRangeChips() {
    const tools = document.querySelector(".cmp-tools");
    if (!tools) return;
    tools.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      const n = b.dataset.range;
      tools.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      document.querySelectorAll("[data-range-view]").forEach((v) => { v.hidden = v.dataset.rangeView !== n; });
      document.querySelectorAll("[data-range-note]").forEach((v) => { v.hidden = v.dataset.rangeNote !== n; });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindRegionChips();
    bindRangeChips();
    // the build bakes the last 24 hours into the page, so the region switch works at once
    try {
      const baked = JSON.parse(($("#trend-data") || {}).textContent || "null");
      if (baked) state.rows = { psi: baked.psi || [], pm: baked.pm || [] };
    } catch { /* fine */ }
    if (state.region !== "max") renderTrends();
    refresh();
    setInterval(() => { if (Date.now() - state.lastLoad >= REFRESH_MS) refresh(); }, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - state.lastLoad >= REFRESH_MS) refresh();
    });
  });
})();

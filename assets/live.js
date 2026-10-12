/* Keeps the auto-collected parts of a page fresh while it stays open:
 * NEA outlook, headlines and (via the map) hotspots. Reads /data/live.json,
 * which the site's scheduled job rewrites every 30 minutes. */
(() => {
  "use strict";
  const REFRESH_MS = 30 * 60 * 1000;
  const subs = [];
  let latest = null;
  let pending = null;

  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtDT = (iso) =>
    new Date(iso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  function load() {
    if (pending) return pending;
    // bust caches once per 10 minutes so CDNs don't serve an old copy for long
    pending = fetch(`/data/live.json?t=${Math.floor(Date.now() / 6e5)}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        latest = j;
        render(j);
        subs.forEach((fn) => { try { fn(j); } catch (e) { console.error(e); } });
        return j;
      })
      .catch(() => latest)
      .finally(() => { pending = null; });
    return pending;
  }

  function render(j) {
    const box = document.getElementById("outlook");
    const a = j.advisory;
    if (box && a && Array.isArray(a.paragraphs)) {
      const bands = { good: "good", moderate: "moderate", unhealthy: "unhealthy", "very unhealthy": "very", hazardous: "hazardous" };
      const b = bands[(a.forecastBand || "").toLowerCase()];
      if (b) box.dataset.band = b;
      box.innerHTML = `<p class="outlook-range">24-hr PSI forecast: ${esc(a.forecastBand || "see NEA")}</p>
        ${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
        <p class="meta">From NEA's haze situation update, ${fmtDT(a.issuedAt)}. <a href="${esc(a.url)}" rel="noopener">Full advisory on haze.gov.sg</a></p>`;
    }
    document.querySelectorAll("ul.headlines[data-feed]").forEach((ul) => {
      const items = (j.headlines && j.headlines[ul.dataset.feed]) || [];
      if (!items.length) return;
      const limit = ul.children.length || 6;
      ul.innerHTML = items
        .slice(0, limit)
        .map((h) => `<li><a href="${esc(h.url)}" rel="noopener nofollow" target="_blank">${esc(h.title)}</a><span class="hl-meta">${esc(h.source)}, <time datetime="${h.publishedAt}">${fmtDT(h.publishedAt)}</time></span></li>`)
        .join("");
    });
  }

  window.sgaqLive = {
    get: () => (latest ? Promise.resolve(latest) : load()),
    subscribe: (fn) => { subs.push(fn); if (latest) fn(latest); },
    refresh: load,
  };

  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
})();

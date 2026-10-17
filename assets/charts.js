/* sgairquality.com 24-hour trend charts (PSI and PM2.5).
 * One file used twice: by scripts/build.mjs (static SVG baked into the HTML)
 * and in the browser (re-drawn every 30 minutes). No dependencies. */
(function (root) {
  "use strict";
  var REGIONS = ["north", "south", "east", "west", "central"];
  var NAME = { max: "Highest region", north: "North", south: "South", east: "East", west: "West", central: "Central" };
  // display order for the region switch: the same reading order as the compass tiles
  var ORDER = ["north", "west", "central", "east", "south"];

  // [upper limit, colour key, label]
  var SCALES = {
    psi: { unit: "24-hr PSI", floor: 120, step: 50, bands: [[50, "good", "Good"], [100, "moderate", "Moderate"], [200, "unhealthy", "Unhealthy"], [300, "very", "Very unhealthy"], [500, "hazardous", "Hazardous"]] },
    pm: { unit: "1-hr PM2.5 µg/m³", floor: 70, step: 25, bands: [[55, "good", "Band I Normal"], [150, "unhealthy", "Band II Elevated"], [250, "very", "Band III High"], [500, "hazardous", "Band IV Very high"]] },
  };

  function bandOf(kind, v) {
    var b = SCALES[kind].bands;
    for (var i = 0; i < b.length; i++) if (v <= b[i][0]) return b[i];
    return b[b.length - 1];
  }

  // rows: [[epochMs, north, south, east, west, central], ...]  -> [{t, v}] for one region or the max
  function pick(rows, region) {
    var idx = REGIONS.indexOf(region);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], v;
      if (idx >= 0) v = r[idx + 1];
      else {
        v = null;
        for (var j = 1; j <= 5; j++) if (typeof r[j] === "number" && (v === null || r[j] > v)) v = r[j];
      }
      if (typeof v === "number") out.push({ t: r[0], v: v });
    }
    return out;
  }

  function sgParts(t) {
    var d = new Date(t + 8 * 3600e3);
    return { h: d.getUTCHours(), day: d.getUTCDate(), mon: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] };
  }
  function hourLabel(h) { return h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? h + "am" : h - 12 + "pm"; }

  function svg(kind, rows, region, opts) {
    opts = opts || {};
    var S = SCALES[kind];
    var pts = pick(rows || [], region || "max");
    if (!pts.length) return '<div class="chart-empty muted">No readings in the last 24 hours yet.</div>';
    var x1 = pts[pts.length - 1].t, x0 = x1 - 24 * 3600e3;
    pts = pts.filter(function (p) { return p.t >= x0; });
    var W = 560, H = 250, L = 34, R = 14, T = 12, B = 28;
    var peak = Math.max.apply(null, [S.floor].concat(pts.map(function (p) { return p.v; })));
    var step = S.step;
    while (peak * 1.12 / step > 7) step *= 2; // keep about 4-7 gridlines
    var yMax = Math.ceil((peak * 1.12) / step) * step;
    var X = function (t) { return L + ((t - x0) / (x1 - x0)) * (W - L - R); };
    var Y = function (v) { return T + (1 - Math.min(v, yMax) / yMax) * (H - T - B); };

    var bands = "", blabels = "", lo = 0;
    for (var i = 0; i < S.bands.length && lo < yMax; i++) {
      var hi = Math.min(S.bands[i][0], yMax);
      bands += '<rect class="band-' + S.bands[i][1] + '" x="' + L + '" y="' + Y(hi).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (Y(lo) - Y(hi)).toFixed(1) + '"/>';
      // labels are drawn after the line (with a halo, see style.css) so the line never runs through them
      if (Y(lo) - Y(hi) > 14) blabels += '<text x="' + (W - R - 5) + '" y="' + (Y(hi) + 12).toFixed(1) + '" text-anchor="end">' + S.bands[i][2] + "</text>";
      lo = S.bands[i][0];
    }
    var grid = "", axis = "";
    for (var v = 0; v <= yMax; v += step) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>';
      axis += '<text x="' + (L - 5) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + "</text>";
    }
    // a tick every 6 hours on the Singapore clock
    var first = Math.ceil(x0 / 3600e3) * 3600e3;
    for (var t = first; t <= x1; t += 3600e3) {
      var p = sgParts(t);
      if (p.h % 6) continue;
      var lbl = p.h === 0 ? p.day + " " + p.mon : hourLabel(p.h);
      grid += '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"' + (p.h ? ' opacity=".45"' : "") + "/>";
      var ax = X(t), anchor = ax > W - R - 22 ? "end" : ax < L + 22 ? "start" : "middle";
      axis += '<text x="' + ax.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + anchor + '">' + lbl + "</text>";
    }
    var d = pts.map(function (q, k) { return (k ? "L" : "M") + X(q.t).toFixed(1) + " " + Y(q.v).toFixed(1); }).join(" ");
    // hover data: one empty <g class="pt"> per reading, read by the tooltip in app.js
    var dots = pts.map(function (q) {
      var s = sgParts(q.t), b = bandOf(kind, q.v);
      return '<g class="pt" data-x="' + X(q.t).toFixed(1) + '" data-y="' + Y(q.v).toFixed(1) + "~band-" + b[1] +
        '" data-t="' + hourLabel(s.h) + ", " + s.day + " " + s.mon + '" data-l="band-' + b[1] + "~" + S.unit + "~" + q.v + "~" + b[2] + '"></g>';
    }).join("");
    var last = pts[pts.length - 1];
    var hiPt = pts.reduce(function (a, b) { return b.v > a.v ? b : a; });
    var loPt = pts.reduce(function (a, b) { return b.v < a.v ? b : a; });
    var lb = bandOf(kind, last.v);
    var who = NAME[region || "max"];
    var label = S.unit + ", " + who.toLowerCase() + ", last 24 hours: now " + last.v + " (" + lb[2] + "), high " + hiPt.v + ", low " + loPt.v + ".";
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + label + '">' +
      '<g class="bands">' + bands + '</g><g class="grid">' + grid + '</g><g class="axis">' + axis + "</g>" +
      '<path class="obs" d="' + d + '"/><g class="bands blabels">' + blabels + '</g>' +
      '<circle class="last band-' + lb[1] + '" cx="' + X(last.t).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) + '" r="5"/>' +
      '<rect class="hit-area" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/>' + dots + "</svg>" +
      '<figcaption><strong>' + last.v + "</strong> now (" + lb[2] + "). 24-hour high " + hiPt.v + ", low " + loPt.v + ". " + who + ", Singapore time.</figcaption>";
  }

  var api = { REGIONS: REGIONS, ORDER: ORDER, NAME: NAME, svg: svg, pick: pick, bandOf: bandOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.sgaqCharts = api;
})(typeof window !== "undefined" ? window : this);

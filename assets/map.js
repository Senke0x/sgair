/* Google Map: NEA fire hotspots, smoke haze areas and Singapore's regional PSI.
 * Loads the Maps JavaScript API only when the map scrolls into view, so visitors
 * who never reach it don't count as a map load. */
(() => {
  "use strict";
  const el = document.getElementById("map");
  if (!el) return;
  const KEY = el.dataset.key;
  const BAND_COLOR = { good: "#2e8b57", moderate: "#2c77b8", unhealthy: "#c98f00", very: "#d9581a", hazardous: "#9e2328" };
  const bandOf = (v) => (v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 200 ? "unhealthy" : v <= 300 ? "very" : "hazardous");
  const BAND_LABEL = { good: "Good", moderate: "Moderate", unhealthy: "Unhealthy", very: "Very unhealthy", hazardous: "Hazardous" };
  const SG_REGIONS = {
    north: [1.41803, 103.82], south: [1.29587, 103.82], east: [1.35735, 103.94], west: [1.35735, 103.7], central: [1.35735, 103.82],
  };
  const REGION_BOUNDS = { north: 5.2, south: -5.4, west: 97.5, east: 117.5 };
  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";

  const STYLE_LIGHT = [
    { elementType: "geometry", stylers: [{ color: "#eef0ec" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#55616c" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f6f7f5" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfdde6" }] },
    { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#97a3ad" }, { weight: 1 }] },
    { featureType: "administrative.province", stylers: [{ visibility: "off" }] },
    { featureType: "road", stylers: [{ visibility: "simplified" }, { lightness: 45 }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ];
  const STYLE_DARK = [
    { elementType: "geometry", stylers: [{ color: "#1d262f" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9aa7b3" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#131a21" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f171f" }] },
    { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4a5a68" }] },
    { featureType: "administrative.province", stylers: [{ visibility: "off" }] },
    { featureType: "road", stylers: [{ visibility: "simplified" }, { lightness: -60 }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ];

  let map, hazeLayer, hotLayer, sgLayer, info, psi = null, started = false;

  function fail(msg) {
    el.innerHTML = `<p class="map-placeholder">${msg} The hotspot counts and headlines on this page are still current. You can also see NEA's own map on <a href="https://www.haze.gov.sg/">haze.gov.sg</a>.</p>`;
  }
  window.gm_authFailure = () => fail("Google Maps refused to load on this address.");

  function start() {
    if (started) return;
    started = true;
    window.__sgaqMapInit = init;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__sgaqMapInit`;
    s.async = true;
    s.onerror = () => fail("Google Maps didn't load.");
    document.head.appendChild(s);
  }

  async function init() {
    const { Map, InfoWindow, Data } = await google.maps.importLibrary("maps");
    const { SymbolPath, LatLngBounds } = await google.maps.importLibrary("core");
    el.innerHTML = "";
    map = new Map(el, {
      center: { lat: 0.6, lng: 106.5 },
      zoom: 5,
      styles: dark ? STYLE_DARK : STYLE_LIGHT,
      disableDefaultUI: true,
      zoomControl: true,
      fullscreenControl: true,
      gestureHandling: "cooperative",
      clickableIcons: false,
      backgroundColor: dark ? "#131a21" : "#eef0ec",
    });
    info = new InfoWindow();

    hazeLayer = new Data({ map });
    hazeLayer.setStyle((f) => {
      const dense = f.getProperty("kind") === "dense";
      return { fillColor: dense ? "#a8382b" : "#e8962a", fillOpacity: dense ? 0.32 : 0.22, strokeColor: dense ? "#a8382b" : "#d9821b", strokeWeight: 1, strokeOpacity: 0.7, clickable: false, zIndex: 1 };
    });

    hotLayer = new Data({ map });
    hotLayer.setStyle({ icon: { path: SymbolPath.CIRCLE, scale: 3.4, fillColor: "#e3461c", fillOpacity: 0.9, strokeColor: dark ? "#131a21" : "#ffffff", strokeWeight: 0.8 }, zIndex: 2 });
    hotLayer.addListener("click", (e) => {
      const p = e.feature;
      const t = String(p.getProperty("time") || "").padStart(4, "0");
      info.setContent(`<div class="iw"><strong>Hotspot, ${p.getProperty("region") || "region"}</strong><br>Satellite ${p.getProperty("sat") || "n/a"} at ${t.slice(0, 2)}:${t.slice(2)}</div>`);
      info.setPosition(e.latLng);
      info.open({ map });
    });

    sgLayer = new Data({ map });
    sgLayer.setStyle((f) => {
      const v = f.getProperty("psi");
      const b = v == null ? "moderate" : bandOf(v);
      const big = f.getProperty("kind") === "island";
      return {
        icon: { path: SymbolPath.CIRCLE, scale: big ? 17 : 15, fillColor: BAND_COLOR[b], fillOpacity: 0.95, strokeColor: "#ffffff", strokeWeight: 2 },
        label: { text: v == null ? "–" : String(v), color: b === "unhealthy" ? "#241b00" : "#ffffff", fontWeight: "700", fontSize: "12px" },
        visible: f.getProperty("visible") !== false,
        zIndex: 5,
      };
    });
    sgLayer.addListener("click", (e) => {
      const v = e.feature.getProperty("psi");
      info.setContent(`<div class="iw"><strong>${e.feature.getProperty("name")}</strong><br>24-hr PSI ${v ?? "–"}${v != null ? `, ${BAND_LABEL[bandOf(v)]}` : ""}</div>`);
      info.setPosition(e.latLng);
      info.open({ map });
    });

    if (psi) setPsi(psi);
    map.addListener("zoom_changed", syncSg);
    setView(el.dataset.view || "region", LatLngBounds);
    document.querySelectorAll(".map-btn").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view, LatLngBounds))
    );

    const src = window.sgaqLive;
    if (src) src.subscribe(applyLive);
    else fetch(`/data/live.json?t=${Math.floor(Date.now() / 6e5)}`).then((r) => r.json()).then(applyLive).catch(() => {});
  }

  function setView(view, LatLngBounds) {
    document.querySelectorAll(".map-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    if (!map) return;
    if (view === "singapore") {
      map.setCenter({ lat: 1.355, lng: 103.82 });
      map.setZoom(11);
    } else {
      const b = new LatLngBounds({ lat: REGION_BOUNDS.south, lng: REGION_BOUNDS.west }, { lat: REGION_BOUNDS.north, lng: REGION_BOUNDS.east });
      map.fitBounds(b, 0);
      google.maps.event.addListenerOnce(map, "idle", () => {
        if (map.getZoom() < 5) { map.setZoom(5); map.setCenter({ lat: -0.3, lng: 106.8 }); }
      });
    }
  }

  function applyLive(j) {
    if (!map || !j) return;
    if (j.haze && j.haze.geojson) {
      hazeLayer.forEach((f) => hazeLayer.remove(f));
      hazeLayer.addGeoJson(j.haze.geojson);
    }
    if (j.hotspots && Array.isArray(j.hotspots.points)) {
      hotLayer.forEach((f) => hotLayer.remove(f));
      hotLayer.addGeoJson({
        type: "FeatureCollection",
        features: j.hotspots.points.map(([lon, lat, region, sat, time]) => ({ type: "Feature", properties: { region, sat, time }, geometry: { type: "Point", coordinates: [lon, lat] } })),
      });
    }
    if (!psi && j.now && j.now.psi) setPsi(j.now.psi);
  }

  function setPsi(readings) {
    psi = readings;
    if (!sgLayer) return;
    sgLayer.forEach((f) => sgLayer.remove(f));
    const vals = Object.values(readings).filter((v) => typeof v === "number");
    const feats = Object.entries(SG_REGIONS).map(([k, [lat, lng]]) => ({
      type: "Feature",
      properties: { kind: "region", name: `Singapore ${k[0].toUpperCase() + k.slice(1)}`, psi: readings[k] },
      geometry: { type: "Point", coordinates: [lng, lat] },
    }));
    feats.push({
      type: "Feature",
      properties: { kind: "island", name: "Singapore (highest region)", psi: vals.length ? Math.max(...vals) : null },
      geometry: { type: "Point", coordinates: [103.82, 1.3521] },
    });
    sgLayer.addGeoJson({ type: "FeatureCollection", features: feats });
    syncSg();
  }

  function syncSg() {
    if (!sgLayer || !map) return;
    const close = map.getZoom() >= 10;
    sgLayer.forEach((f) => f.setProperty("visible", f.getProperty("kind") === "island" ? !close : close));
  }

  // live PSI from app.js on the home page
  document.addEventListener("sgaq:psi", (e) => setPsi(e.detail));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: "300px" });
    io.observe(el);
  } else start();
})();

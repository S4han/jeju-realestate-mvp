// Stand-in for the Kakao Maps SDK in Phase 3 E2E tests: the Phase 1 fake plus Polygon/LatLngBounds.
// Each polygon becomes a button (data-region) inside the map element so tests can click regions.
(function () {
  var listeners = [];
  function fire(target, type) {
    listeners.filter(function (l) { return l.t === target && l.type === type; }).forEach(function (l) { l.h(); });
  }
  function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
  LatLng.prototype.getLat = function () { return this.lat; };
  LatLng.prototype.getLng = function () { return this.lng; };
  function LatLngBounds() { this.n = 0; }
  LatLngBounds.prototype.extend = function () { this.n++; };
  function Map(el, opts) {
    this.el = el; this.center = opts.center; this.level = opts.level; this.layer = document.createElement("div");
    this.layer.setAttribute("data-polygons", ""); el.appendChild(this.layer); window.__fakeMap = this;
  }
  Map.prototype.getBounds = function () { var c = this.center; return { getSouthWest: function () { return c; }, getNorthEast: function () { return c; } }; };
  Map.prototype.setCenter = function (c) { this.center = c; };
  Map.prototype.setLevel = function (l) { this.level = l; };
  Map.prototype.setBounds = function (b) { this.bounds = b.n; };
  Map.prototype.relayout = function () {};
  function Polygon(o) {
    var self = this; this.o = o; this.b = document.createElement("button"); this.b.type = "button";
    this.b.setAttribute("data-region", ""); this.b.setAttribute("data-fill", o.fillColor); this.b.setAttribute("data-dashed", String(o.strokeStyle === "dash"));
    this.b.setAttribute("data-stroke", String(o.strokeWeight));
    this.b.onclick = function () { fire(self, "click"); };
    if (o.map) o.map.layer.appendChild(this.b);
  }
  Polygon.prototype.setMap = function (m) { if (!m && this.b.parentNode) this.b.parentNode.removeChild(this.b); };
  Polygon.prototype.setOptions = function () {};
  window.kakao = { maps: {
    load: function (cb) { cb(); },
    LatLng: LatLng, LatLngBounds: LatLngBounds, Map: Map, Polygon: Polygon,
    event: { addListener: function (t, type, h) { listeners.push({ t: t, type: type, h: h }); } },
  } };
})();

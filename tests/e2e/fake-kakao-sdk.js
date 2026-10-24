// Stand-in for the Kakao Maps SDK used only by E2E tests. Renders markers as buttons and logs calls.
(function () {
  var listeners = [];
  function fire(target, type) {
    listeners.filter(function (l) { return l.t === target && l.type === type; }).forEach(function (l) { l.h(); });
  }
  function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
  LatLng.prototype.getLat = function () { return this.lat; };
  LatLng.prototype.getLng = function () { return this.lng; };
  function Map(el, opts) {
    this.el = el; this.center = opts.center; this.level = opts.level;
    window.__fakeMap = this;
    var self = this;
    setTimeout(function () { fire(self, "idle"); }, 0);
  }
  Map.prototype.getBounds = function () {
    var half = 0.0012 * Math.pow(2, this.level), c = this.center;
    return {
      getSouthWest: function () { return new LatLng(c.lat - half * 0.6, c.lng - half); },
      getNorthEast: function () { return new LatLng(c.lat + half * 0.6, c.lng + half); },
    };
  };
  Map.prototype.setCenter = function (c) { this.center = c; var s = this; setTimeout(function () { fire(s, "idle"); }, 0); };
  Map.prototype.setLevel = function (l) { this.level = l; };
  Map.prototype.relayout = function () {};
  function Marker(o) { this.o = o; }
  Marker.prototype.setMap = function () {};
  function MarkerClusterer(o) { this.map = o.map; this.box = document.createElement("div"); this.box.setAttribute("data-markers", ""); o.map.el.appendChild(this.box); }
  MarkerClusterer.prototype.addMarkers = function (ms) {
    var box = this.box;
    box.setAttribute("data-count", String(ms.length));
    ms.slice(0, 40).forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = m.o.title; b.setAttribute("data-marker", "");
      b.onclick = function () { fire(m, "click"); };
      box.appendChild(b);
    });
  };
  MarkerClusterer.prototype.clear = function () { this.box.innerHTML = ""; this.box.setAttribute("data-count", "0"); };
  window.kakao = { maps: {
    load: function (cb) { cb(); },
    LatLng: LatLng, Map: Map, Marker: Marker, MarkerClusterer: MarkerClusterer,
    event: { addListener: function (t, type, h) { listeners.push({ t: t, type: type, h: h }); } },
  } };
})();

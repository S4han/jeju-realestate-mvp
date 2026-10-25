// EPSG:5186 (Korea 2000 / Central Belt 2010) ↔ WGS84 lon/lat. Transverse Mercator on GRS80 (Snyder series),
// written out here so no projection package is needed. Accuracy is far below a metre for Jeju.
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 1.0;
const LON0 = (127 * Math.PI) / 180;
const LAT0 = (38 * Math.PI) / 180;
const FE = 200000.0;
const FN = 600000.0;
const RAD = Math.PI / 180;

function meridian(phi: number): number {
  return A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi
    - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
}
const M0 = meridian(LAT0);

/** WGS84 (lon, lat in degrees) → EPSG:5186 (x east, y north in metres). */
export function toTm(lon: number, lat: number): [number, number] {
  const phi = lat * RAD;
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = (lon * RAD - LON0) * Math.cos(phi);
  const x = FE + K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const y = FN + K0 * (meridian(phi) - M0 + n * Math.tan(phi) * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** EPSG:5186 (x, y metres) → WGS84 [lon, lat] in degrees. */
export function fromTm(x: number, y: number): [number, number] {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = (M0 + (y - FN) / K0) / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = EP2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = (x - FE) / (n1 * K0);
  const lat = phi1 - ((n1 * Math.tan(phi1)) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = LON0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
  return [lon / RAD, lat / RAD];
}

/** True when a .prj describes EPSG:5186 (the only source CRS the loader accepts). */
export const isEpsg5186 = (prj: string) => /AUTHORITY\s*\[\s*"EPSG"\s*,\s*"5186"\s*\]\s*\]\s*$/.test(prj.trim()) && /central_meridian"?,\s*127(\.0+\d*)?\b/.test(prj) && /false_northing"?,\s*600000/.test(prj);

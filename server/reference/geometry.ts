import proj4 from "proj4";

export type Ring = [number, number][];
export type PolygonCoords = Ring[]; // [outer, ...holes]
export type Point = { x: number; y: number };

// Korea 2000 / Central Belt 2010 (EPSG:5186), the CRS of the national continuous cadastral map.
const EPSG_5186 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const toLonLat = proj4(EPSG_5186, "EPSG:4326");

export function epsg5186ToWgs84(p: Point): { lat: number; lon: number } {
  const [lon, lat] = toLonLat.forward([p.x, p.y]) as [number, number];
  return { lat, lon };
}

function ringSignedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return s / 2;
}

function ringCentroidTimesArea(ring: Ring): { cx: number; cy: number; a: number } {
  let cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]!;
    const [x1, y1] = ring[i]!;
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  const a = ringSignedArea(ring);
  return { cx: cx / 6, cy: cy / 6, a };
}

// Area and centroid of polygons with holes; outer rings add, holes subtract (orientation-independent).
export function areaAndCentroid(polygons: PolygonCoords[]): { area: number; centroid: Point } {
  let area = 0, sx = 0, sy = 0;
  for (const poly of polygons) {
    poly.forEach((ring, idx) => {
      const { cx, cy, a } = ringCentroidTimesArea(ring);
      if (a === 0) return;
      // cx/a, cy/a is the ring centroid whatever the winding; weight it by |a|.
      const w = (idx === 0 ? 1 : -1) * Math.abs(a);
      area += w;
      sx += (cx / a) * w;
      sy += (cy / a) * w;
    });
  }
  return { area, centroid: { x: sx / area, y: sy / area } };
}

// Even-odd ray casting over every ring, so holes are excluded.
export function containsPoint(polygons: PolygonCoords[], p: Point): boolean {
  let inside = false;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

// A point guaranteed inside: midpoint of the widest interior span on the horizontal line through y.
export function representativePoint(polygons: PolygonCoords[], y: number): Point | null {
  const xs: number[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
  }
  xs.sort((a, b) => a - b);
  let best: Point | null = null, width = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1]! - xs[k]!;
    if (w > width) {
      width = w;
      best = { x: (xs[k]! + xs[k + 1]!) / 2, y };
    }
  }
  return best;
}

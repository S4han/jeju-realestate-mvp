// Shared-border simplification: neighbouring regions use the same simplified line for the border they
// share, so simplifying never opens gaps or overlaps between them (P3-TASK-002 10절). Rings are split at
// "nodes" — vertices where the set of rings using the border changes — and each chain is simplified once
// (Douglas–Peucker, fixed ends) and reused by every ring that contains it.
import { ringArea, type Point, type Ring } from "./shapefile.js";

const key = ([x, y]: Point) => `${x},${y}`;

function douglasPeucker(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[j]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let max = -1;
    let at = -1;
    for (let m = i + 1; m < j; m++) {
      const [px, py] = pts[m]!;
      const d = len === 0 ? Math.hypot(px - x1, py - y1) : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
      if (d > max) {
        max = d;
        at = m;
      }
    }
    if (max > tol && at > 0) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** A closed ring with no fixed node: split at the vertex farthest from its start so both halves have distinct ends. */
function simplifyClosed(ring: Ring, tol: number): Ring {
  const [sx, sy] = ring[0]!;
  let far = 0;
  let best = -1;
  ring.forEach(([x, y], k) => {
    const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d > best) {
      best = d;
      far = k;
    }
  });
  return [...douglasPeucker(ring.slice(0, far + 1), tol).slice(0, -1), ...douglasPeucker(ring.slice(far), tol)];
}

export type SimplifyResult = { features: Ring[][]; droppedRings: number; sharedChains: number };

/**
 * Simplifies every feature's closed rings with tolerance `tol` (same units as the coordinates).
 * Rings that collapse below 4 points are dropped unless that would leave a feature with no ring,
 * in which case its largest original ring is kept unsimplified.
 */
export function simplifyShared(features: Ring[][], tol: number): SimplifyResult {
  // Which rings use each undirected segment.
  const segRings = new Map<string, string>();
  const ringIds: string[][] = features.map((rings, f) => rings.map((_, r) => `${f}:${r}`));
  const seg = (a: Point, b: Point) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  features.forEach((rings, f) =>
    rings.forEach((ring, r) => {
      for (let i = 0; i + 1 < ring.length; i++) {
        const s = seg(ring[i]!, ring[i + 1]!);
        const prev = segRings.get(s);
        const id = ringIds[f]![r]!;
        if (!prev) segRings.set(s, id);
        else if (!prev.split(",").includes(id)) segRings.set(s, `${prev},${id}`);
      }
    }),
  );
  const owners = (a: Point, b: Point) => segRings.get(seg(a, b))!.split(",").sort().join(",");

  const cache = new Map<string, Point[]>();
  let shared = 0;
  const simplifyChain = (chain: Point[]): Point[] => {
    const fwd = chain.map(key).join(";");
    const rev = chain.slice().reverse().map(key).join(";");
    const canonicalIsFwd = fwd <= rev;
    const k = canonicalIsFwd ? fwd : rev;
    let s = cache.get(k);
    if (s) shared++;
    else {
      const base = canonicalIsFwd ? chain : chain.slice().reverse();
      s = base[0]![0] === base[base.length - 1]![0] && base[0]![1] === base[base.length - 1]![1] ? simplifyClosed(base, tol) : douglasPeucker(base, tol);
      cache.set(k, s);
    }
    return canonicalIsFwd ? s : s.slice().reverse();
  };

  let dropped = 0;
  const out = features.map((rings) => {
    const kept: Ring[] = [];
    for (const ring of rings) {
      const n = ring.length - 1; // closed: ring[n] equals ring[0]
      if (n < 3) continue;
      const nodes: number[] = [];
      for (let i = 0; i < n; i++) {
        const prev = ring[(i - 1 + n) % n]!;
        if (owners(prev, ring[i]!) !== owners(ring[i]!, ring[i + 1]!)) nodes.push(i);
      }
      let result: Ring;
      if (tol <= 0) result = ring.slice();
      else if (nodes.length === 0) result = simplifyClosed(ring, tol);
      else {
        result = [];
        for (let c = 0; c < nodes.length; c++) {
          const from = nodes[c]!;
          const to = nodes[(c + 1) % nodes.length]!;
          const chain: Point[] = [];
          for (let i = from; ; i = (i + 1) % n) {
            chain.push(ring[i]!);
            if (i === to && chain.length > 1) break;
          }
          const part = simplifyChain(chain);
          result.push(...(result.length ? part.slice(1) : part));
        }
      }
      if (result.length >= 4) kept.push(result);
      else dropped++;
    }
    if (!kept.length && rings.length) {
      kept.push(rings.reduce((a, b) => (Math.abs(ringArea(a)) >= Math.abs(ringArea(b)) ? a : b)).slice());
      dropped--;
    }
    return kept;
  });
  return { features: out, droppedRings: Math.max(dropped, 0), sharedChains: shared };
}


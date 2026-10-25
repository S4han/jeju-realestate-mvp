// Minimal readers for the two shapefile parts the boundary loader needs: polygon geometry (.shp) and
// attributes (.dbf). Only what the official legal-boundary files use is supported; anything else throws.
export type Point = [number, number];
export type Ring = Point[];

/** Polygons of a .shp file, one entry per record (an empty array for a null shape). */
export function readPolygons(shp: Buffer): Ring[][] {
  if (shp.readInt32BE(0) !== 9994) throw new Error("not a shapefile");
  const type = shp.readInt32LE(32);
  if (type !== 5) throw new Error(`unsupported shape type ${type} (polygon expected)`);
  const out: Ring[][] = [];
  let pos = 100;
  while (pos + 8 <= shp.length) {
    const contentBytes = shp.readInt32BE(pos + 4) * 2;
    const body = pos + 8;
    const recType = shp.readInt32LE(body);
    if (recType === 0) {
      out.push([]);
    } else {
      if (recType !== 5) throw new Error(`unsupported record type ${recType}`);
      const numParts = shp.readInt32LE(body + 36);
      const numPoints = shp.readInt32LE(body + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(shp.readInt32LE(body + 44 + 4 * i));
      const p0 = body + 44 + 4 * numParts;
      const rings: Ring[] = [];
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1]! : numPoints;
        const ring: Ring = [];
        for (let k = parts[i]!; k < end; k++) ring.push([shp.readDoubleLE(p0 + 16 * k), shp.readDoubleLE(p0 + 16 * k + 8)]);
        rings.push(ring);
      }
      out.push(rings);
    }
    pos = body + contentBytes;
  }
  return out;
}

/** Attribute rows of a .dbf file as strings (text decoded with the given encoding, e.g. "euc-kr"). */
export function readDbf(dbf: Buffer, encoding: string): Record<string, string>[] {
  const count = dbf.readUInt32LE(4);
  const headerLen = dbf.readUInt16LE(8);
  const recordLen = dbf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let i = 32; i < headerLen - 1; i += 32) {
    const name = dbf.subarray(i, i + 11).toString("latin1").replace(/\0.*$/s, "");
    fields.push({ name, len: dbf[i + 16]! });
  }
  const decoder = new TextDecoder(encoding);
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < count; r++) {
    let o = headerLen + r * recordLen + 1; // skip the deletion flag
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = decoder.decode(dbf.subarray(o, o + f.len)).replace(/\0/g, "").trim();
      o += f.len;
    }
    rows.push(row);
  }
  return rows;
}

/** Signed area (shoelace); shapefile outer rings are clockwise, i.e. negative here. */
export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return s / 2;
}

/** Even-odd point-in-polygon over all rings of one feature. */
export function containsPoint(rings: Ring[], [x, y]: Point): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i++) {
      const [x1, y1] = r[i]!;
      const [x2, y2] = r[i + 1]!;
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

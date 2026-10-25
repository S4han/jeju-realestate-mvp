// Writes tiny polygon shapefiles (.shp + .dbf) in memory for Phase 3 tests (fictional geometry).
export type FixtureFeature = { attrs: Record<string, string>; rings: [number, number][][] };

export function writePolygonShp(features: FixtureFeature[]): Buffer {
  const records = features.map((f) => {
    const pts = f.rings.flat();
    const body = Buffer.alloc(44 + 4 * f.rings.length + 16 * pts.length);
    body.writeInt32LE(5, 0);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => body.writeDoubleLE(v, 4 + 8 * i));
    body.writeInt32LE(f.rings.length, 36);
    body.writeInt32LE(pts.length, 40);
    let start = 0;
    f.rings.forEach((r, i) => {
      body.writeInt32LE(start, 44 + 4 * i);
      start += r.length;
    });
    const p0 = 44 + 4 * f.rings.length;
    pts.forEach(([x, y], k) => {
      body.writeDoubleLE(x, p0 + 16 * k);
      body.writeDoubleLE(y, p0 + 16 * k + 8);
    });
    return body;
  });
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  const total = 100 + records.reduce((n, r) => n + 8 + r.length, 0);
  header.writeInt32BE(total / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  const parts = [header];
  records.forEach((r, i) => {
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(r.length / 2, 4);
    parts.push(h, r);
  });
  return Buffer.concat(parts);
}

export function writeDbf(rows: Record<string, string>[], fields: { name: string; len: number }[], encode: (s: string) => Buffer): Buffer {
  const headerLen = 32 + 32 * fields.length + 1;
  const recordLen = 1 + fields.reduce((n, f) => n + f.len, 0);
  const header = Buffer.alloc(headerLen);
  header.writeUInt8(3, 0);
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt16LE(headerLen, 8);
  header.writeUInt16LE(recordLen, 10);
  fields.forEach((f, i) => {
    header.write(f.name, 32 + 32 * i, "latin1");
    header.writeUInt8("C".charCodeAt(0), 32 + 32 * i + 11);
    header.writeUInt8(f.len, 32 + 32 * i + 16);
  });
  header.writeUInt8(0x0d, headerLen - 1);
  const body = rows.map((row) => {
    const rec = Buffer.alloc(recordLen, 0x20);
    let o = 1;
    for (const f of fields) {
      encode(row[f.name] ?? "").copy(rec, o, 0, f.len);
      o += f.len;
    }
    return rec;
  });
  return Buffer.concat([header, ...body]);
}

import * as shapefile from "shapefile";
import type { Parcel } from "./location";
import type { PolygonCoords } from "./geometry";

// Reads the continuous cadastral SHP (A1 = PNU, A5 = 지번+지목) and returns only the wanted parcels.
// The DBF is CP949 even though the bundled .cpg says UTF-8 (verified in TASK-001).
export async function readParcels(shpBasePath: string, wanted: Set<string>): Promise<{ parcels: Map<string, Parcel>; scanned: number }> {
  const source = await shapefile.open(`${shpBasePath}.shp`, `${shpBasePath}.dbf`, { encoding: "euc-kr" });
  const parcels = new Map<string, Parcel>();
  let scanned = 0;
  for (;;) {
    const { done, value } = await source.read();
    if (done) break;
    scanned++;
    const props = value.properties as { A1?: string; A5?: string } | null;
    const pnu = props?.A1?.trim();
    if (!pnu || !wanted.has(pnu)) continue;
    const g = value.geometry;
    let polygons: PolygonCoords[];
    if (g?.type === "Polygon") polygons = [g.coordinates as PolygonCoords];
    else if (g?.type === "MultiPolygon") polygons = g.coordinates as PolygonCoords[];
    else continue;
    if (parcels.has(pnu)) throw new Error(`duplicate parcel polygon for PNU ${pnu}`);
    parcels.set(pnu, { pnu, jimok: (props?.A5 ?? "").trim().slice(-1), polygons });
  }
  return { parcels, scanned };
}

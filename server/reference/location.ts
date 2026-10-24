import { areaAndCentroid, containsPoint, epsg5186ToWgs84, representativePoint, type PolygonCoords } from "./geometry.js";

export type Parcel = { pnu: string; jimok: string; polygons: PolygonCoords[] };

export type LocationResult =
  | { status: "NONE"; flags: string[] }
  | { status: "VERIFIED_PARCEL" | "REVIEW"; flags: string[]; lat: number; lon: number; areaM2: number; method: "PARCEL_CENTROID" | "REPRESENTATIVE_POINT" };

// Thresholds from the TASK-001 trial (docs/API_VERIFICATION.md, 5차).
export const SMALL_PARCEL_M2 = 300;
export const LARGE_COMPLEX_UNITS = 100;
export const LARGE_COMPLEX_MIN_PARCEL_M2 = 1000;

// Parcel centroid as the marker point; suspicious parcels are kept but marked REVIEW (no marker).
export function assessLocation(parcel: Parcel | undefined, unitCount: number | null): LocationResult {
  if (!parcel) return { status: "NONE", flags: ["PARCEL_NOT_FOUND"] };
  const { area, centroid } = areaAndCentroid(parcel.polygons);
  const flags: string[] = [];
  let point = centroid;
  let method: "PARCEL_CENTROID" | "REPRESENTATIVE_POINT" = "PARCEL_CENTROID";
  if (!containsPoint(parcel.polygons, centroid)) {
    const rp = representativePoint(parcel.polygons, centroid.y);
    if (!rp) return { status: "NONE", flags: ["DEGENERATE_PARCEL"] };
    point = rp;
    method = "REPRESENTATIVE_POINT";
    flags.push("REPRESENTATIVE_POINT");
  }
  const review: string[] = [];
  if (parcel.jimok !== "대") review.push("NON_RESIDENTIAL_JIMOK");
  if (area < SMALL_PARCEL_M2) review.push("SMALL_PARCEL");
  if ((unitCount ?? 0) >= LARGE_COMPLEX_UNITS && area < LARGE_COMPLEX_MIN_PARCEL_M2) review.push("PARCEL_SMALL_FOR_UNITS");
  const { lat, lon } = epsg5186ToWgs84(point);
  return {
    status: review.length ? "REVIEW" : "VERIFIED_PARCEL",
    flags: [...review, ...flags],
    lat,
    lon,
    areaM2: area,
    method,
  };
}

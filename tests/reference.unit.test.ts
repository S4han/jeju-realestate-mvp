import path from "node:path";
import { describe, expect, it } from "vitest";
import { readParcels } from "../server/reference/cadastral";
import { areaAndCentroid, containsPoint, epsg5186ToWgs84, representativePoint, type PolygonCoords } from "../server/reference/geometry";
import { assessLocation } from "../server/reference/location";
import { parseRebApartments, type RebRow } from "../server/reference/reb";

const square = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x, y + h], [x + w, y + h], [x + w, y], [x, y]];

describe("geometry", () => {
  it("computes area and centroid regardless of ring winding", () => {
    const cw: PolygonCoords[] = [[square(0, 0, 100, 50)]];
    const ccw: PolygonCoords[] = [[[...square(0, 0, 100, 50)].reverse()]];
    for (const p of [cw, ccw]) {
      const { area, centroid } = areaAndCentroid(p);
      expect(area).toBeCloseTo(5000);
      expect(centroid.x).toBeCloseTo(50);
      expect(centroid.y).toBeCloseTo(25);
    }
  });

  it("subtracts holes", () => {
    const withHole: PolygonCoords[] = [[square(0, 0, 10, 10), square(0, 0, 5, 10)]];
    const { area, centroid } = areaAndCentroid(withHole);
    expect(area).toBeCloseTo(50);
    expect(centroid.x).toBeCloseTo(7.5);
    expect(containsPoint(withHole, { x: 2, y: 5 })).toBe(false);
    expect(containsPoint(withHole, { x: 8, y: 5 })).toBe(true);
  });

  it("finds an interior point when the centroid is outside (U shape)", () => {
    const u: PolygonCoords[] = [[[[0, 0], [0, 60], [10, 60], [10, 10], [50, 10], [50, 60], [60, 60], [60, 0], [0, 0]]]];
    const { centroid } = areaAndCentroid(u);
    expect(containsPoint(u, centroid)).toBe(false);
    const rp = representativePoint(u, centroid.y)!;
    expect(containsPoint(u, rp)).toBe(true);
  });

  it("converts EPSG:5186 to WGS84 like pyproj", () => {
    const origin = epsg5186ToWgs84({ x: 200000, y: 600000 });
    expect(origin.lat).toBeCloseTo(38, 9);
    expect(origin.lon).toBeCloseTo(127, 9);
    // Reference value computed with pyproj (EPSG:5186 → EPSG:4326).
    const jeju = epsg5186ToWgs84({ x: 150050, y: 100025 });
    expect(jeju.lat).toBeCloseTo(33.492708049412265, 8);
    expect(jeju.lon).toBeCloseTo(126.46250369456688, 8);
  });
});

const reb = (over: Partial<RebRow>): RebRow => ({
  COMPLEX_PK: "50110100000001", PNU: "5011013700100010000", ADRES: "제주특별자치도 제주시 연동 1",
  ROAD_ADRES: "연동로 1", COMPLEX_NM1: "테스트", COMPLEX_NM2: null, COMPLEX_NM3: null, COMPLEX_GB_CD: "1",
  DONG_CNT: 1, UNIT_CNT: 120, USEAPR_DT: "20170105", ...over,
});

describe("parseRebApartments", () => {
  it("keeps Jeju apartments only and reports malformed rows", () => {
    const { apartments, skipped } = parseRebApartments([
      reb({}),
      reb({ COMPLEX_PK: "2", COMPLEX_GB_CD: "3" }), // 다세대: ignored silently
      reb({ COMPLEX_PK: "3", PNU: "1111017400104360064" }),
      reb({ COMPLEX_PK: "4", PNU: null }),
      reb({ COMPLEX_PK: "5", COMPLEX_NM1: "  " }),
    ]);
    expect(apartments.map((a) => a.rebComplexPk)).toEqual(["50110100000001"]);
    expect(skipped).toEqual([
      { complexPk: "3", reason: "NOT_JEJU" },
      { complexPk: "4", reason: "INVALID_PNU" },
      { complexPk: "5", reason: "NO_NAME" },
    ]);
  });

  it("derives codes, addresses, dates and de-duplicated aliases", () => {
    const [a] = parseRebApartments([
      reb({ PNU: "5013010500100030000", COMPLEX_NM1: "외도부영2차", COMPLEX_NM2: "부영아파트", COMPLEX_NM3: "외도부영2차", USEAPR_DT: "20010130" }),
    ]).apartments;
    expect(a).toMatchObject({
      cityCode: "50130",
      legalDongCode: "5013010500",
      roadAddress: "제주특별자치도 서귀포시 연동로 1",
      approvedOn: "2001-01-30",
      aliases: [{ name: "외도부영2차", source: "REB_NM1" }, { name: "부영아파트", source: "REB_NM2" }],
    });
  });

  it("does not invent dates or unit counts", () => {
    const [a] = parseRebApartments([reb({ USEAPR_DT: "2017", UNIT_CNT: null })]).apartments;
    expect(a!.approvedOn).toBeNull();
    expect(a!.unitCount).toBeNull();
  });
});

describe("cadastral reader + assessLocation (synthetic fixture)", () => {
  const base = path.resolve("tests/fixtures/cadastral/mini");
  const wanted = new Set(["5011013700100010000", "5011013700100020000", "5013010500100030000", "5011013700199990000"]);

  it("reads CP949 attributes despite the UTF-8 .cpg and returns only wanted parcels", async () => {
    const { parcels, scanned } = await readParcels(base, wanted);
    expect(scanned).toBe(4);
    expect([...parcels.keys()].sort()).toEqual(["5011013700100010000", "5011013700100020000", "5013010500100030000"]);
    expect(parcels.get("5011013700100010000")!.jimok).toBe("대");
    expect(parcels.get("5011013700100020000")!.jimok).toBe("전");
  });

  it("classifies parcels into VERIFIED_PARCEL / REVIEW / NONE with reasons", async () => {
    const { parcels } = await readParcels(base, wanted);
    const ok = assessLocation(parcels.get("5011013700100010000"), 120);
    expect(ok).toMatchObject({ status: "VERIFIED_PARCEL", flags: [], method: "PARCEL_CENTROID" });
    if (ok.status === "NONE") throw new Error("unreachable");
    expect(ok.lat).toBeCloseTo(33.492708049412265, 7);
    expect(ok.areaM2).toBeCloseTo(5000);

    const u = assessLocation(parcels.get("5011013700100020000"), 10);
    expect(u.status).toBe("REVIEW");
    expect(u.flags).toEqual(["NON_RESIDENTIAL_JIMOK", "REPRESENTATIVE_POINT"]);

    const tiny = assessLocation(parcels.get("5013010500100030000"), 150);
    expect(tiny.status).toBe("REVIEW");
    expect(tiny.flags).toEqual(["SMALL_PARCEL", "PARCEL_SMALL_FOR_UNITS"]);

    expect(assessLocation(parcels.get("5011013700199990000"), 50)).toEqual({ status: "NONE", flags: ["PARCEL_NOT_FOUND"] });
  });
});

import { describe, expect, it } from "vitest";
import { fromTm, isEpsg5186, toTm } from "../../server/phase3/geo/tm5186";
import { containsPoint, readDbf, readPolygons, ringArea, type Ring } from "../../server/phase3/geo/shapefile";
import { simplifyShared } from "../../server/phase3/geo/simplify";
import { dealAgreesWithApartment, umdOf } from "../../server/phase3/regionCode";
import { writeDbf, writePolygonShp } from "../helpers/shapefileFixture";

const utf8 = (s: string) => Buffer.from(s, "utf8");

describe("EPSG:5186 transverse mercator", () => {
  it("maps the projection origin to the false origin and round-trips across Jeju", () => {
    const [x, y] = toTm(127, 38);
    expect(x).toBeCloseTo(200000, 6);
    expect(y).toBeCloseTo(600000, 6);
    for (const [lon, lat] of [[126.15, 33.2], [126.95, 33.55], [126.5312, 33.4996], [126.27, 33.96]]) {
      const [lo, la] = fromTm(...toTm(lon!, lat!));
      expect(Math.abs(lo - lon!) * 93_000).toBeLessThan(0.01); // metres
      expect(Math.abs(la - lat!) * 111_000).toBeLessThan(0.01);
    }
  });

  it("accepts only an EPSG:5186 .prj", () => {
    const prj = 'PROJCS["Korea 2000 / Central Belt 2010", GEOGCS["Korea 2000"], PROJECTION["Transverse_Mercator"], PARAMETER["central_meridian", 127.00000000000001], PARAMETER["latitude_of_origin", 38.00000000000001], PARAMETER["false_easting", 200000.0], PARAMETER["false_northing", 600000.0], UNIT["m", 1.0], AUTHORITY["EPSG","5186"]]';
    expect(isEpsg5186(prj)).toBe(true);
    expect(isEpsg5186(prj.replace("5186", "5179"))).toBe(false);
    expect(isEpsg5186(prj.replace("600000.0", "500000.0"))).toBe(false);
  });
});

describe("shapefile readers", () => {
  it("reads polygons with several rings and dbf rows", () => {
    const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]];
    const shp = writePolygonShp([{ attrs: {}, rings: [sq(0, 0, 10)] }, { attrs: {}, rings: [sq(20, 0, 5), sq(40, 0, 2)] }]);
    const polys = readPolygons(shp);
    expect(polys).toHaveLength(2);
    expect(polys[1]).toHaveLength(2);
    expect(ringArea(polys[0]![0]!)).toBe(-100); // clockwise outer ring
    expect(containsPoint(polys[1]!, [41, 1])).toBe(true);
    expect(containsPoint(polys[1]!, [30, 1])).toBe(false);
    const dbf = writeDbf([{ EMD_CD: "50110101", EMD_NM: "일도일동" }], [{ name: "EMD_CD", len: 8 }, { name: "EMD_NM", len: 30 }], utf8);
    expect(readDbf(dbf, "utf-8")).toEqual([{ EMD_CD: "50110101", EMD_NM: "일도일동" }]);
  });

  it("decodes EUC-KR attribute text", () => {
    const dbf = writeDbf([{ N: "x" }], [{ name: "N", len: 4 }], () => Buffer.from([0xc1, 0xa6, 0xc1, 0xd6])); // 제주
    expect(readDbf(dbf, "euc-kr")[0]!.N).toBe("제주");
  });
});

describe("shared-border simplification", () => {
  // Two regions share a jagged border (x≈1000); the left one also has a tiny islet.
  const border: [number, number][] = Array.from({ length: 21 }, (_, i) => [1000 + (i % 2 ? 3 : -3), i * 50] as [number, number]);
  const left: Ring = [[0, 0], [0, 1000], ...border.slice().reverse(), [0, 0]];
  const right: Ring = [...border, [2000, 1000], [2000, 0], border[0]!];
  const islet: Ring = [[-100, -100], [-100, -98], [-98, -98], [-98, -100], [-100, -100]];

  it("keeps neighbours on exactly the same simplified border and drops collapsed islets", () => {
    const { features, droppedRings, sharedChains } = simplifyShared([[left, islet], [right]], 10);
    expect(droppedRings).toBe(1);
    expect(sharedChains).toBeGreaterThan(0);
    const key = (p: [number, number]) => `${p[0]},${p[1]}`;
    const onBorder = (r: Ring) => [...new Set(r.filter(([x]) => x > 900 && x < 1100).map(key))].sort();
    expect(onBorder(features[0]![0]!)).toEqual(onBorder(features[1]![0]!));
    expect(features[0]![0]!.length).toBeLessThan(left.length);
    expect(features[1]![0]!.at(0)).toEqual(features[1]![0]!.at(-1)); // still closed
  });

  it("tolerance 0 returns the original rings", () => {
    const { features } = simplifyShared([[left], [right]], 0);
    expect(features[0]![0]).toEqual(left);
  });
});

describe("region codes", () => {
  it("rolls ri codes up to their eup/myeon and rejects non-Jeju or city codes", () => {
    expect(umdOf("5011025021")).toBe("5011025000");
    expect(umdOf("5011010400")).toBe("5011010400");
    expect(umdOf("5011000000")).toBeNull();
    expect(umdOf("1111010100")).toBeNull();
    expect(umdOf(null)).toBeNull();
    expect(dealAgreesWithApartment("50110", "25021", "5011025033")).toBe(true);
    expect(dealAgreesWithApartment("50110", "10400", "5011010500")).toBe(false);
    expect(dealAgreesWithApartment("50110", null, "5011010500")).toBeNull();
  });
});

// Fictional Phase 3 fixture: 2 cities, 4 eup/myeon/dong as 1 km squares in EPSG:5186 near Jeju city.
import { toTm } from "../../server/phase3/geo/tm5186";
import type { BoundaryFiles, SetMeta } from "../../server/phase3/regionSet";
import { writeDbf, writePolygonShp, type FixtureFeature } from "../helpers/shapefileFixture";

export const PRJ = 'PROJCS["Korea 2000 / Central Belt 2010", PARAMETER["central_meridian", 127.0], PARAMETER["false_easting", 200000.0], PARAMETER["false_northing", 600000.0], AUTHORITY["EPSG","5186"]]';
export const CODES = `﻿법정동코드,시도명,시군구명,읍면동명,리명,순번,생성일자
5000000000,제주특별자치도,,,,0,2006-07-01
5011000000,제주특별자치도,제주시,,,0,2006-07-01
5013000000,제주특별자치도,서귀포시,,,0,2006-07-01
5011010100,제주특별자치도,제주시,일도일동,,0,2006-07-01
5011010200,제주특별자치도,제주시,일도이동,,0,2006-07-01
5011025000,제주특별자치도,제주시,한림읍,,0,2006-07-01
5011025021,제주특별자치도,제주시,한림읍,한림리,0,2006-07-01
5013010100,제주특별자치도,서귀포시,서귀동,,0,2006-07-01
1111010100,서울특별시,종로구,청운동,,0,1988-04-23`;

// Four 1 km squares in EPSG:5186 near Jeju city (clockwise outer rings, like the official files).
const [OX, OY] = toTm(126.5, 33.45).map(Math.round) as [number, number];
export const sq = (i: number): [number, number][] => {
  const x = OX + i * 1000;
  return [[x, OY], [x, OY + 1000], [x + 1000, OY + 1000], [x + 1000, OY], [x, OY]];
};
export const FEATURES: FixtureFeature[] = [
  { attrs: { EMD_CD: "50110101", COL_ADM_SE: "50110", EMD_NM: "일도일동" }, rings: [sq(0)] },
  { attrs: { EMD_CD: "50110102", COL_ADM_SE: "50110", EMD_NM: "일도이동" }, rings: [sq(1)] },
  { attrs: { EMD_CD: "50110250", COL_ADM_SE: "50110", EMD_NM: "한림읍" }, rings: [sq(2)] },
  { attrs: { EMD_CD: "50130101", COL_ADM_SE: "50130", EMD_NM: "서귀동" }, rings: [sq(3)] },
];
export const FIELDS = [{ name: "EMD_CD", len: 8 }, { name: "COL_ADM_SE", len: 5 }, { name: "EMD_NM", len: 30 }];
export const files = (features = FEATURES, prj = PRJ): BoundaryFiles => ({
  shp: writePolygonShp(features),
  dbf: writeDbf(features.map((f) => f.attrs), FIELDS, (s) => Buffer.from(s, "utf8")),
  prj,
  encoding: "utf-8",
});
export const META: SetMeta = { codeSource: "test", codeAsOf: "2026-06-30", codeChecksum: "c", boundarySource: "test", boundaryAsOf: "2026-10-01", boundaryChecksum: "b", sourceCrs: "EPSG:5186", toleranceM: 20 };
export const center = (i: number) => {
  // Inverse of the square centre, via a tiny search-free approach: reuse toTm on a guessed point.
  const lng = 126.5 + (i * 1000 + 500) / 93_000;
  const lat = 33.45 + 500 / 111_000;
  return { lng, lat };
};


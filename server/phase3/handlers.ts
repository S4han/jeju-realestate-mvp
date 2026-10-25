// GET /api/v3/regions/{view} (P3-TASK-005). One function serves every view (P3-D4); views and query:
//   status                                     active region set, data status, snapshotId (24 months)
//   list                                       cities and their eup/myeon/dong (with "has apartments")
//   boundaries   level, parentRegionId          simplified GeoJSON of the eup/myeon/dong (city view: all)
//   statistics   level, parentRegionId, period, metric   map values, classes and legend
//   detail       regionId, period               one region (or city): statistics, change, monthly counts
//   apartments   regionId, period, pageSize, cursor     complexes traded in the period, latest first
//   compare      regionIds=a,b, period          two regions from the same snapshot
//   trend        regionId                       last 12 vs previous 12 months + 24 monthly counts
// Every statistics response carries snapshotId; a client may send it back (snapshotId=…) and gets 409 if
// the data changed in between, so a screen never mixes versions.
import type pg from "pg";
import { z } from "zod";
import { serviceUnavailable, type HandlerResult } from "../http.js";
import { PERIODS, periodWindow, withSnapshot, type Period } from "../phase2/analysis.js";
import { MIN_SECRET_LENGTH, decodeCursor, encodeCursor } from "../phase2/cursor.js";
import { REGION_DEALS_SQL } from "./mapping.js";
import { quantileClasses } from "./quantiles.js";
import { activeSetId } from "./regionSet.js";
import { loadRegionMonthly, loadRegionStats, snapshotId, type RegionStat } from "./statistics.js";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const err = (status: number, code: string, message?: string): HandlerResult => ({ status, body: { error: { code, ...(message ? { message } : {}) } } });
const CACHE_SECONDS = 300;

export const VIEWS = ["status", "list", "boundaries", "statistics", "detail", "apartments", "compare", "trend"] as const;
type View = (typeof VIEWS)[number];

const regionCode = z.string().regex(/^50(110|130)\d{3}00$/, "invalid region id");
const cityRegion = z.enum(["5011000000", "5013000000"]);
const querySchema = z.object({
  level: z.enum(["city", "legal_dong"]).optional(),
  parentRegionId: cityRegion.optional(),
  period: z.coerce.number().refine((p) => (PERIODS as readonly number[]).includes(p), "period must be 12, 24 or 36").default(24),
  metric: z.enum(["price_per_m2", "trade_count"]).default("price_per_m2"),
  regionId: regionCode.optional(),
  regionIds: z.string().max(40).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(1024).optional(),
  snapshotId: z.string().max(64).optional(),
});

export type RegionsEnv = { cursorSecret?: string; phase2Enabled?: boolean; now?: Date };

/** Values that colour the map for the chosen metric; ineligible regions are left out (shown as "no data"). */
function eligible(regions: RegionStat[], metric: "price_per_m2" | "trade_count"): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of regions) {
    if (metric === "price_per_m2" && r.priceStatus === "AVAILABLE") m.set(r.regionCode, r.medianPricePerM2Won!);
    if (metric === "trade_count" && r.hasApartments && r.countStatus === "COMPLETE") m.set(r.regionCode, r.tradeCount);
  }
  return m;
}

export async function handleRegions(pool: pg.Pool, view: string | undefined, query: Query, env: RegionsEnv = {}): Promise<HandlerResult> {
  if (!view || !(VIEWS as readonly string[]).includes(view)) return err(404, "NOT_FOUND");
  const parsed = querySchema.safeParse(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, one(v) || undefined])));
  if (!parsed.success) return err(400, "INVALID_ARGUMENT", parsed.error.issues[0]!.message);
  const q = parsed.data;
  const period = q.period as Period;
  const now = env.now ?? new Date();

  // Input rules that do not need the database.
  if ((view === "statistics" || view === "boundaries") && q.level === "legal_dong" && !q.parentRegionId) return err(400, "INVALID_ARGUMENT", "parentRegionId is required for level=legal_dong");
  if ((view === "statistics" || view === "boundaries") && q.level === "city" && q.parentRegionId) return err(400, "INVALID_ARGUMENT", "parentRegionId is not allowed for level=city");
  if (["detail", "apartments", "trend"].includes(view) && !q.regionId) return err(400, "INVALID_ARGUMENT", "regionId is required");
  let compareIds: string[] = [];
  if (view === "compare") {
    compareIds = (q.regionIds ?? "").split(",").map((s) => s.trim());
    if (compareIds.length !== 2 || compareIds[0] === compareIds[1] || !compareIds.every((id) => regionCode.safeParse(id).success)) {
      return err(400, "INVALID_ARGUMENT", "regionIds must be two different region ids");
    }
  }
  if (view === "apartments" && (!env.cursorSecret || env.cursorSecret.length < MIN_SECRET_LENGTH)) {
    console.error("Invalid region analysis environment: P3_CURSOR_SECRET");
    return serviceUnavailable("ANALYSIS_MISCONFIGURED");
  }

  try {
    return await withSnapshot(pool, async (c) => {
      const setId = await activeSetId(c);
      if (!setId) return serviceUnavailable("NO_VERIFIED_SNAPSHOT");
      const set = (await c.query(
        `SELECT set_id, code_source, to_char(code_as_of, 'YYYY-MM-DD') AS code_as_of, boundary_source,
                to_char(boundary_as_of, 'YYYY-MM-DD') AS boundary_as_of, simplify_tolerance_m FROM p3_region_sets WHERE set_id = $1`,
        [setId],
      )).rows[0];
      const boundaryVersion = `${setId}:${set.boundary_as_of}`;
      const regionRow = async (code: string) =>
        (await c.query<{ region_code: string; level: "CITY" | "UMD"; name: string; city_code: string }>(
          "SELECT region_code, level, name, city_code FROM p3_regions WHERE set_id = $1 AND region_code = $2",
          [setId, code],
        )).rows[0];

      // The snapshot of the requested period; a client-sent snapshotId must match it.
      const win = periodWindow(period, now);
      const span = period >= 24 ? win : periodWindow(24, now);
      const snap = await snapshotId(c, setId, span.from, span.to, span.months);
      if (q.snapshotId && q.snapshotId !== snap) {
        return err(409, "SNAPSHOT_MISMATCH", "데이터가 갱신되었습니다. 지도를 다시 불러와 주세요.");
      }
      const base = { snapshotId: snap, boundaryVersion, periodMonths: period, generatedAt: now.toISOString(), staleAfterHours: 48 };
      const ok = (body: object): HandlerResult => ({ status: 200, body: { ...base, ...body }, cacheSeconds: CACHE_SECONDS });
      const statsOf = (level: "CITY" | "UMD", cityCode?: string) => loadRegionStats(c, { setId, level, cityCode, period, now });

      switch (view as View) {
        case "status": {
          const s = await statsOf("CITY");
          return ok({
            enabled: true,
            regionSet: { setId, codeSource: set.code_source, codeAsOf: set.code_as_of, boundarySource: set.boundary_source, boundaryAsOf: set.boundary_as_of, simplifyToleranceM: Number(set.simplify_tolerance_m) },
            dataStatus: s.dataStatus,
          });
        }
        case "list": {
          const s = [...(await statsOf("UMD", "50110")).regions, ...(await statsOf("UMD", "50130")).regions];
          const cities = (await c.query("SELECT region_code, name FROM p3_regions WHERE set_id = $1 AND level = 'CITY' ORDER BY region_code", [setId])).rows;
          return ok({
            regions: cities.map((city) => ({
              regionId: city.region_code,
              name: city.name,
              level: "city",
              children: s.filter((r) => r.cityCode === city.region_code.slice(0, 5)).map((r) => ({ regionId: r.regionCode, name: r.name, level: "legal_dong", hasApartments: r.hasApartments })),
            })),
          });
        }
        case "boundaries": {
          const city = q.level === "legal_dong" ? q.parentRegionId!.slice(0, 5) : null;
          const rows = (await c.query(
            `SELECT b.region_code, r.name, r.city_code, b.geometry, b.bbox FROM p3_region_boundaries b
               JOIN p3_regions r USING (set_id, region_code)
              WHERE b.set_id = $1 AND ($2::text IS NULL OR r.city_code = $2) ORDER BY b.region_code`,
            [setId, city],
          )).rows;
          return {
            status: 200,
            cacheSeconds: CACHE_SECONDS,
            body: {
              boundaryVersion,
              source: set.boundary_source,
              crs: "EPSG:4326",
              type: "FeatureCollection",
              features: rows.map((r) => ({
                type: "Feature",
                id: r.region_code,
                properties: { regionId: r.region_code, name: r.name, cityRegionId: `${r.city_code}00000`, bbox: r.bbox.map(Number) },
                geometry: r.geometry,
              })),
            },
          };
        }
        case "statistics": {
          const level = q.level ?? "city";
          const s = level === "city" ? await statsOf("CITY") : await statsOf("UMD", q.parentRegionId!.slice(0, 5));
          const { classOf, legend } = quantileClasses(eligible(s.regions, q.metric));
          return ok({
            level,
            parentRegionId: q.parentRegionId ?? null,
            metric: q.metric,
            contractPeriod: s.contractPeriod,
            legend: { ...legend, unit: q.metric === "price_per_m2" ? "KRW_PER_M2" : "TRADES" },
            regions: s.regions.map((r) => ({ ...r, regionId: r.regionCode, class: classOf.get(r.regionCode) ?? null })),
            unmapped: s.unmapped,
            dataStatus: s.dataStatus,
          });
        }
        case "detail":
        case "trend": {
          const r = await regionRow(q.regionId!);
          if (!r) return err(404, "UNKNOWN_REGION");
          const p = view === "trend" ? (24 as Period) : period;
          const s = await loadRegionStats(c, { setId, level: r.level, cityCode: r.city_code, period: p, now });
          const stat = s.regions.find((x) => x.regionCode === r.region_code)!;
          const monthly = await loadRegionMonthly(c, { setId, regionCode: r.region_code, period: p, now });
          if (view === "trend") return ok({ regionId: r.region_code, name: r.name, change: stat.change, monthly, dataStatus: s.dataStatus });
          return ok({
            region: { ...stat, regionId: stat.regionCode },
            contractPeriod: s.contractPeriod,
            monthly,
            unmapped: r.level === "CITY" ? s.unmapped[r.city_code] : undefined,
            dataStatus: s.dataStatus,
          });
        }
        case "compare": {
          const rows = await Promise.all(compareIds.map(regionRow));
          if (rows.some((r) => !r)) return err(404, "UNKNOWN_REGION");
          const items = [];
          for (const r of rows) {
            const s = await loadRegionStats(c, { setId, level: r!.level, cityCode: r!.city_code, period, now });
            items.push({ ...s.regions.find((x) => x.regionCode === r!.region_code)!, regionId: r!.region_code, dataStatus: s.dataStatus });
          }
          return ok({ contractPeriod: { startInclusive: win.from, endExclusive: win.to }, regions: items });
        }
        case "apartments": {
          const r = await regionRow(q.regionId!);
          if (!r) return err(404, "UNKNOWN_REGION");
          const secret = env.cursorSecret!;
          let after: { d: string; i: string } | null = null;
          if (q.cursor) {
            const cur = decodeCursor(q.cursor, secret);
            if (!cur || cur.a !== r.region_code || cur.p !== period) return err(400, "INVALID_ARGUMENT", "invalid cursor");
            if (cur.v !== snap) return err(409, "SNAPSHOT_MISMATCH", "데이터가 갱신되었습니다. 처음부터 다시 조회해 주세요.");
            after = { d: cur.d, i: cur.i };
          }
          const regionFilter = r.level === "CITY" ? "left(d.region_code, 5) = $4" : "d.region_code = $4";
          const { rows } = await c.query(
            `SELECT a.apartment_id, a.name, a.road_address, a.lot_address, g.trade_count, g.last_date
               FROM (SELECT d.apartment_id, count(*)::int AS trade_count, to_char(max(d.contract_date), 'YYYY-MM-DD') AS last_date
                       FROM (${REGION_DEALS_SQL}) d WHERE d.mapping_status = 'MAPPED' AND ${regionFilter} GROUP BY 1) g
               JOIN apartments a ON a.apartment_id = g.apartment_id
              WHERE ($5::date IS NULL OR (g.last_date::date, g.apartment_id) < ($5::date, $6::bigint))
              ORDER BY g.last_date DESC, g.apartment_id DESC LIMIT $7`,
            [setId, win.from, win.to, r.level === "CITY" ? r.city_code : r.region_code, after?.d ?? null, after?.i ?? null, q.pageSize + 1],
          );
          const items = rows.slice(0, q.pageSize).map((x) => ({
            apartmentId: String(x.apartment_id),
            name: x.name,
            address: x.road_address ?? x.lot_address,
            tradeCount: x.trade_count,
            lastContractDate: x.last_date,
            links: { detail: `#/apartments/${x.apartment_id}`, priceAnalysis: env.phase2Enabled ? `#/apartments/${x.apartment_id}` : null },
          }));
          const last = items.at(-1);
          const nextCursor = rows.length > q.pageSize && last
            ? encodeCursor({ a: r.region_code, ar: "all", p: period, v: snap, d: last.lastContractDate, i: last.apartmentId }, secret)
            : null;
          return ok({ regionId: r.region_code, contractPeriod: { startInclusive: win.from, endExclusive: win.to }, items, nextCursor });
        }
      }
    });
  } catch (e) {
    console.error("region analysis query failed", (e as Error).name);
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}

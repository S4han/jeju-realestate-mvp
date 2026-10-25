// GET /api/v2/analysis/apartments/{id}/{view} (P2-TASK-004, API_SPEC). One function serves every view (D5).
// Inputs are validated here; all database work goes through the read-only snapshot in analysis.ts.
import type pg from "pg";
import { z } from "zod";
import { serviceUnavailable, type HandlerResult } from "../http.js";
import {
  PERIODS, defaultArea, loadAnalysis, loadEvidencePage, loadPoints, periodWindow, withSnapshot,
  type AreaSel, type Period,
} from "./analysis.js";
import { MIN_SECRET_LENGTH, decodeCursor, encodeCursor } from "./cursor.js";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const badRequest = (message: string): HandlerResult => ({ status: 400, body: { error: { code: "BAD_REQUEST", message } } });
const notFound: HandlerResult = { status: 404, body: { error: { code: "NOT_FOUND" } } };
const CACHE_SECONDS = 300;

export const VIEWS = ["status", "areas", "summary", "monthly", "points", "transactions"] as const;
type View = (typeof VIEWS)[number];

const querySchema = z.object({
  period: z.coerce.number().refine((p) => (PERIODS as readonly number[]).includes(p), "period must be 12, 24 or 36").default(24),
  areaType: z.union([z.literal("all"), z.coerce.number().int().min(1).max(1000)]).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(1024).optional(),
});

export type AnalysisEnv = { cursorSecret?: string; now?: Date };

export async function handleAnalysis(pool: pg.Pool, id: string | undefined, view: string | undefined, query: Query, env: AnalysisEnv = {}): Promise<HandlerResult> {
  if (!view || !(VIEWS as readonly string[]).includes(view)) return notFound;
  if (!id || !/^\d{1,18}$/.test(id)) return badRequest("invalid apartment id");
  const parsed = querySchema.safeParse(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, one(v) || undefined])));
  if (!parsed.success) return badRequest(parsed.error.issues[0]!.message);
  const q = parsed.data;
  const period = q.period as Period;
  const now = env.now ?? new Date();
  if (view === "transactions" && (!env.cursorSecret || env.cursorSecret.length < MIN_SECRET_LENGTH)) {
    console.error("Invalid analysis environment: P2_CURSOR_SECRET");
    return serviceUnavailable("ANALYSIS_MISCONFIGURED");
  }

  try {
    return await withSnapshot(pool, async (c) => {
      // Area type: explicit, else the default (most traded, smaller on ties), else "all" when there are no deals.
      const resolveArea = async (): Promise<AreaSel | null> => {
        if (q.areaType !== undefined) return q.areaType;
        const a = await loadAnalysis(c, { apartmentId: id, area: "all", period, now });
        if (!a) return null;
        return defaultArea(a.areas) ?? "all";
      };
      const area = await resolveArea();
      if (area === null) return notFound;
      const analysis = await loadAnalysis(c, { apartmentId: id, area, period, now });
      if (!analysis) return notFound;
      const base = { apartmentId: id, periodMonths: period, areaTypeM2: area, dataVersion: analysis.dataStatus.dataVersion };
      const ok = (body: object): HandlerResult => ({ status: 200, body: { ...base, ...body }, cacheSeconds: CACHE_SECONDS });

      switch (view as View) {
        case "status":
          return ok({ enabled: true, apartment: { name: analysis.apartment.name, cityCode: analysis.apartment.cityCode }, dataStatus: analysis.dataStatus });
        case "areas":
          return ok({ areas: analysis.areas, defaultAreaTypeM2: defaultArea(analysis.areas) });
        case "summary":
          return ok({
            summary: { ...analysis.summary, yearOverYearChangePct: analysis.comparison.changePct, comparisonStatus: analysis.comparison.status },
            comparison: analysis.comparison,
            dataStatus: analysis.dataStatus,
          });
        case "monthly":
          return ok({ monthly: analysis.monthly, quarterly: analysis.quarterly, dataStatus: analysis.dataStatus });
        case "points": {
          if (area === "all") return badRequest("areaType is required for points");
          const p = await loadPoints(c, id, area, period, now);
          return ok({ points: p.points, truncated: p.truncated });
        }
        case "transactions": {
          // Evidence lists prices, so like points it needs one area type ("all" would mix areas, PRD).
          if (area === "all") return badRequest("areaType is required for transactions");
          const secret = env.cursorSecret!;
          let after;
          if (q.cursor) {
            const cur = decodeCursor(q.cursor, secret);
            if (!cur || cur.a !== id || cur.ar !== area || cur.p !== period) return badRequest("invalid cursor");
            // The version is re-derived from the current data; any change since page 1 restarts paging.
            if (cur.v !== analysis.dataStatus.dataVersion) {
              return { status: 409, body: { error: { code: "DATA_VERSION_CHANGED", message: "데이터가 갱신되었습니다. 처음부터 다시 조회해 주세요." } } };
            }
            after = { contractDate: cur.d, transactionId: cur.i };
          }
          const page = await loadEvidencePage(c, { apartmentId: id, area, period, now, pageSize: q.pageSize, after });
          const nextCursor = page.next
            ? encodeCursor({ a: id, ar: area, p: period, v: analysis.dataStatus.dataVersion, d: page.next.contractDate, i: page.next.transactionId }, secret)
            : null;
          const win = periodWindow(period, now);
          return ok({ items: page.items, nextCursor, tradeCount: analysis.summary.tradeCount, window: { from: win.from, to: win.to } });
        }
      }
    });
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}


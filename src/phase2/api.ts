// Client for the Phase 2 price-analysis API (/api/v2/analysis/apartments/{id}/{view}, API_SPEC).
import { ApiError } from "../api";

export type Period = 12 | 24 | 36;
export type AreaSel = number | "all";
export type PriceStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "NO_TRADES" | "INCOMPLETE_DATA" | "UNAVAILABLE";

export type DataStatus = {
  completeness: "COMPLETE" | "INCOMPLETE";
  freshness: "FRESH" | "STALE";
  lastSuccessfulSyncAt: string | null;
  missingMonths: string[];
  partialMonths: string[];
  provisionalCurrentMonth: boolean;
  dataVersion: string;
};

type Base = { apartmentId: string; periodMonths: Period; areaTypeM2: AreaSel; dataVersion: string };

export type AreasView = Base & { areas: { areaTypeM2: number; tradeCount: number }[]; defaultAreaTypeM2: number | null };
export type SummaryView = Base & {
  summary: {
    tradeCount: number;
    medianPriceWon: number | null;
    minPriceWon: number | null;
    maxPriceWon: number | null;
    medianPricePerM2Won: number | null;
    priceStatus: PriceStatus;
    yearOverYearChangePct: number | null;
    comparisonStatus: PriceStatus;
  };
  comparison: { recentTradeCount?: number; previousTradeCount?: number; months?: { recent: [string, string]; previous: [string, string] } };
  dataStatus: DataStatus;
};
export type MonthlyView = Base & {
  monthly: { contractMonth: string; tradeCount: number | null; collectionStatus: "COMPLETE" | "PARTIAL" | "MISSING"; isCurrentMonth: boolean }[];
  quarterly: { quarter: string; tradeCount: number; medianPriceWon: number | null; priceStatus: PriceStatus; complete: boolean }[];
  dataStatus: DataStatus;
};
export type Deal = { transactionId: string; contractDate: string; priceWon: number; areaM2: number; floor: number | null; sameConditionCount: number };
export type PointsView = Base & { points: Deal[]; truncated: boolean };
export type EvidenceView = Base & { items: Deal[]; nextCursor: string | null; tradeCount: number };

type Params = { period?: Period; areaType?: AreaSel; pageSize?: number; cursor?: string };

export async function fetchAnalysis<T>(id: string, view: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const res = await fetch(`/api/v2/analysis/apartments/${encodeURIComponent(id)}/${view}${qs.size ? `?${qs}` : ""}`, { signal });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

// The tab exists only when the status view answers 200; a 404 means the feature flag is off (D4).
export async function isAnalysisAvailable(id: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetchAnalysis(id, "status", {}, signal);
    return true;
  } catch {
    return false;
  }
}

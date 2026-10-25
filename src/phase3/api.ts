// Client for the Phase 3 region analysis API (/api/v3/regions/{view}, P3-TASK-005).
import { ApiError } from "../api";

export type Period = 12 | 24 | 36;
export type Metric = "price_per_m2" | "trade_count";
export type PriceStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "NO_TRADES" | "NO_APARTMENTS" | "INCOMPLETE_DATA";
export type ChangeStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "INCOMPLETE_DATA" | "NO_APARTMENTS";

export type DataStatus = {
  completeness: "COMPLETE" | "INCOMPLETE";
  freshness: "FRESH" | "STALE";
  lastSuccessfulSyncAt: string | null;
  missingMonths: string[];
  partialMonths: string[];
  provisionalCurrentMonth: boolean;
  currentMonth: string;
};

export type RegionStat = {
  regionId: string;
  name: string;
  level: "CITY" | "UMD";
  cityCode: string;
  hasApartments: boolean;
  tradeCount: number;
  countStatus: "COMPLETE" | "INCOMPLETE";
  medianPricePerM2Won: number | null;
  priceStatus: PriceStatus;
  change: { pct: number | null; status: ChangeStatus; recentMedianWon: number | null; previousMedianWon: number | null; recentCount: number; previousCount: number };
  class?: number | null;
};

export type Unmapped = { mapped: number; unmatched: number; codeConflict: number; codeNotInSet: number; total: number };
type Base = { snapshotId: string; boundaryVersion: string; periodMonths: Period; generatedAt: string };

export type Legend = { method: string; effectiveClassCount: number; eligibleRegionCount: number; classes: { index: number; min: number; max: number; count: number }[]; unit: "KRW_PER_M2" | "TRADES" };
export type StatisticsView = Base & {
  level: "city" | "legal_dong";
  parentRegionId: string | null;
  metric: Metric;
  contractPeriod: { startInclusive: string; endExclusive: string };
  legend: Legend;
  regions: RegionStat[];
  unmapped: Record<string, Unmapped>;
  dataStatus: DataStatus;
};
export type Feature = { id: string; properties: { regionId: string; name: string; cityRegionId: string; bbox: number[] }; geometry: { type: "MultiPolygon"; coordinates: number[][][][] } };
export type BoundariesView = { boundaryVersion: string; source: string; features: Feature[] };
export type Monthly = { contractMonth: string; tradeCount: number | null; collectionStatus: "COMPLETE" | "PARTIAL" | "MISSING"; isCurrentMonth: boolean }[];
export type DetailView = Base & { region: RegionStat; contractPeriod: { startInclusive: string; endExclusive: string }; monthly: Monthly; unmapped?: Unmapped; dataStatus: DataStatus };
export type ApartmentsView = Base & {
  items: { apartmentId: string; name: string; address: string | null; tradeCount: number; lastContractDate: string; links: { detail: string; priceAnalysis: string | null } }[];
  nextCursor: string | null;
};
export type CompareView = Base & { contractPeriod: { startInclusive: string; endExclusive: string }; regions: (RegionStat & { dataStatus: DataStatus })[] };
export type StatusView = Base & { regionSet: { codeSource: string; codeAsOf: string; boundarySource: string; boundaryAsOf: string } };

export async function fetchRegions<T>(view: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`/api/v3/regions/${view}${qs.size ? `?${qs}` : ""}`, { signal });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

// The entry point exists only when the status view answers 200; 404 means the feature flag is off (P3-D3).
export async function isRegionAnalysisAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    await fetchRegions("status", {}, signal);
    return true;
  } catch {
    return false;
  }
}

export const CITY_IDS = { "5011000000": "제주시", "5013000000": "서귀포시" } as const;

export type CityCode = "50110" | "50130";

export type ApartmentListItem = {
  id: string;
  name: string;
  city_code: CityCode;
  road_address: string | null;
  lot_address: string | null;
  lat: number | null;
  lng: number | null;
  location_status: string;
};

export type MapMarker = { id: string; name: string; lat: number; lng: number; recent_count: number };

export type Deal = { contract_date: string; area_m2: number; floor: number | null; sale_price: number | null; deposit: number | null; monthly_rent: number | null };

export type ApartmentDetail = ApartmentListItem & {
  unit_count: number | null;
  approved_on: string | null;
  recent: { from: string; sale_count: number; rent_count: number; last_sale: Deal | null; last_rent: Deal | null };
  source: { reference: string; transactions: string; reference_as_of: string | null };
};

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API ${status}`);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export function searchApartments(q: string, city: CityCode | "", signal?: AbortSignal) {
  const qs = new URLSearchParams({ q, limit: "10" });
  if (city) qs.set("city_code", city);
  return getJson<{ items: ApartmentListItem[] }>(`/api/apartments/search?${qs}`, signal);
}

export function fetchMarkers(bbox: [number, number, number, number], city: CityCode | "", signal?: AbortSignal) {
  const qs = new URLSearchParams({ bbox: bbox.map((v) => v.toFixed(6)).join(",") });
  if (city) qs.set("city_code", city);
  return getJson<{ items: MapMarker[]; truncated: boolean }>(`/api/apartments/map?${qs}`, signal);
}

export function fetchApartment(id: string, signal?: AbortSignal) {
  return getJson<ApartmentDetail>(`/api/apartments/${encodeURIComponent(id)}`, signal);
}

export type TradeType = "sale" | "rent";
export type SortKey = "date_desc" | "date_asc" | "price_desc" | "price_asc" | "area_desc" | "area_asc";

export type DealRow = Deal & {
  id: string;
  trade_type: TradeType;
  contract_type: string | null;
  contract_term: string | null;
  apt_dong: string | null;
  registered_on: string | null;
};

export type TransactionList = {
  apartment: { id: string; name: string; city_code: CityCode };
  filter: { type: TradeType; from: string; to: string; sort: SortKey; area_min: number | null; area_max: number | null };
  page: { page: number; page_size: number; total: number };
  items: DealRow[];
  area_groups: { m2: number; n: number }[];
  data: { missing_months: string[]; last_success_at: string | null; delayed: boolean; source: string };
};

export function fetchTransactions(
  id: string,
  p: { type: TradeType; sort: SortKey; page: number; area?: number | null },
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({ type: p.type, sort: p.sort, page: String(p.page), page_size: "20" });
  if (p.area != null) {
    qs.set("area_min", String(p.area));
    qs.set("area_max", String(p.area + 0.9999));
  }
  return getJson<TransactionList>(`/api/apartments/${encodeURIComponent(id)}/transactions?${qs}`, signal);
}

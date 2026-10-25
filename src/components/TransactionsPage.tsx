import { useEffect, useState } from "react";
import { fetchApartment, fetchTransactions, type ApartmentDetail, type DealRow, type SortKey, type TradeType, type TransactionList } from "../api";
import { CITY_LABEL, displayAddress, formatArea, formatFloor, formatKrw, formatRent } from "../format";
import { isAnalysisAvailable } from "../phase2/api";
import { PriceAnalysis } from "../phase2/PriceAnalysis";

const SORT_LABEL: Record<SortKey, string> = {
  date_desc: "최신순",
  date_asc: "오래된순",
  price_desc: "가격 높은순",
  price_asc: "가격 낮은순",
  area_desc: "면적 넓은순",
  area_asc: "면적 좁은순",
};

const ym = (s: string) => s.replace("-", ".");

// Transaction detail (SCR-003): confirmed, non-cancelled deals of the last 12 contract months.
export function TransactionsPage({ id }: { id: string }) {
  const [apt, setApt] = useState<ApartmentDetail | null>(null);
  const [type, setType] = useState<TradeType>("sale");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [area, setArea] = useState<number | null>(null);
  const [pages, setPages] = useState<TransactionList[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // Phase 2 (D4): the price-analysis tab appears only when its status API answers 200 (feature flag on).
  const [analysisTab, setAnalysisTab] = useState(false);
  const [analysis, setAnalysis] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchApartment(id, ctrl.signal).then(setApt).catch(() => {});
    isAnalysisAvailable(id, ctrl.signal).then((ok) => !ctrl.signal.aborted && setAnalysisTab(ok));
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    setPages([]);
    fetchTransactions(id, { type, sort, page: 1, area }, ctrl.signal)
      .then((r) => {
        setPages([r]);
        setState("ready");
      })
      .catch((e) => (e as Error).name !== "AbortError" && setState("error"));
    return () => ctrl.abort();
  }, [id, type, sort, area, retry]);

  const first = pages[0];
  const items = pages.flatMap((p) => p.items);
  const total = first?.page.total ?? 0;
  const loadMore = () => {
    fetchTransactions(id, { type, sort, page: pages.length + 1, area })
      .then((r) => setPages((ps) => [...ps, r]))
      .catch(() => setState("error"));
  };

  return (
    <div className="min-h-dvh bg-slate-50 pb-10 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <a
            href="#/"
            onClick={(e) => {
              // Back to wherever the user came from (dashboard, map or list); "#/" when opened directly.
              if (window.history.length > 1) {
                e.preventDefault();
                window.history.back();
              }
            }}
            className="text-sm text-sky-700"
          >
            ← 돌아가기
          </a>
          <h1 className="mt-1 text-lg font-semibold">{apt?.name ?? first?.apartment.name ?? "불러오는 중…"}</h1>
          {apt && (
            <p className="text-xs text-slate-600">
              {CITY_LABEL[apt.city_code]} · {displayAddress(apt.road_address, apt.lot_address)}
              {apt.unit_count ? ` · ${apt.unit_count.toLocaleString("ko-KR")}세대` : ""}
              {apt.approved_on ? ` · ${apt.approved_on.slice(0, 4)}년 사용승인` : ""}
            </p>
          )}
          <div className={`mt-3 grid ${analysisTab ? "grid-cols-3" : "grid-cols-2"} rounded-lg bg-slate-100 p-1 text-sm`} role="tablist">
            {(["sale", "rent"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={!analysis && type === t}
                onClick={() => {
                  setAnalysis(false);
                  setType(t);
                  setArea(null);
                  setOpen(null);
                }}
                className={`rounded-md py-1.5 ${!analysis && type === t ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}
              >
                {t === "sale" ? "매매" : "전월세"}
                {apt && ` ${t === "sale" ? apt.recent.sale_count : apt.recent.rent_count}건`}
              </button>
            ))}
            {analysisTab && (
              <button
                type="button"
                role="tab"
                aria-selected={analysis}
                onClick={() => setAnalysis(true)}
                className={`rounded-md py-1.5 ${analysis ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}
              >
                가격 분석
              </button>
            )}
          </div>
          <div className={`mt-2 flex items-center gap-2 ${analysis ? "hidden" : ""}`}>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="전용면적 필터">
              {[null, ...(first?.area_groups.map((g) => g.m2) ?? [])].map((m) => (
                <button
                  key={m ?? "all"}
                  type="button"
                  aria-pressed={area === m}
                  onClick={() => setArea(m)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${area === m ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white"}`}
                >
                  {m === null ? "전체 면적" : `${m}㎡`}
                </button>
              ))}
            </div>
            <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
              {Object.entries(SORT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-3">
        {analysis && <PriceAnalysis id={id} />}
        <div hidden={analysis}>
        {first && first.data.missing_months.length > 0 && (
          <p role="alert" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {first.data.missing_months.map(ym).join(", ")} 데이터를 수집하지 못해 해당 기간 거래가 빠져 있을 수 있습니다.
          </p>
        )}
        {first?.data.delayed && (
          <p role="alert" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            데이터 갱신이 지연되고 있습니다. 마지막 정상 갱신 정보를 표시합니다.
          </p>
        )}
        {state === "loading" && <p className="py-8 text-center text-sm text-slate-500">거래를 불러오는 중…</p>}
        {state === "error" && (
          <div className="py-8 text-center text-sm">
            <p className="text-red-700">거래 정보를 불러올 수 없습니다.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1">
              다시 시도
            </button>
          </div>
        )}
        {state === "ready" && first && total === 0 && (
          <p className="py-8 text-center text-sm text-slate-600">
            {ym(first.filter.from)} ~ {ym(first.filter.to)} 기간에 확인된 {type === "sale" ? "매매" : "전월세"} 거래가 없습니다.
          </p>
        )}
        {state === "ready" && total > 0 && (
          <>
            <p className="mb-2 text-xs text-slate-500">
              {ym(first!.filter.from)} ~ {ym(first!.filter.to)} · {total}건 · {SORT_LABEL[sort]}
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {items.map((d) => (
                <DealItem key={d.id} d={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />
              ))}
            </ul>
            {items.length < total && (
              <button type="button" onClick={loadMore} className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm">
                더 보기 ({items.length}/{total})
              </button>
            )}
          </>
        )}
        </div>
        <footer className="mt-6 space-y-1 text-[11px] leading-4 text-slate-500">
          <p>출처: {first?.data.source ?? "국토교통부 실거래가 공개시스템(공공데이터포털)"}, 한국부동산원 공동주택 단지 식별정보.</p>
          {first?.data.last_success_at && <p>마지막 데이터 갱신: {new Date(first.data.last_success_at).toLocaleString("ko-KR")}</p>}
          <p>해제된 거래와 단지 연결이 확인되지 않은 거래는 표시하지 않습니다. 실거래 신고 기한(계약 후 30일) 때문에 최근 1~2개월 거래는 늘어날 수 있습니다.</p>
        </footer>
      </main>
    </div>
  );
}

function DealItem({ d, open, onToggle }: { d: DealRow; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{d.trade_type === "sale" ? formatKrw(d.sale_price) : formatRent(d.deposit, d.monthly_rent)}</span>
          <span className="block text-xs text-slate-500">
            {formatArea(d.area_m2)} · {formatFloor(d.floor)}
          </span>
        </span>
        <span className="shrink-0 text-xs text-slate-500">{d.contract_date}</span>
      </button>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 bg-slate-50 px-3 py-2 text-xs">
          <dt className="text-slate-500">계약일</dt>
          <dd>{d.contract_date}</dd>
          {d.trade_type === "sale" ? (
            <>
              <dt className="text-slate-500">거래금액</dt>
              <dd>{formatKrw(d.sale_price)}</dd>
              <dt className="text-slate-500">등기</dt>
              <dd>{d.registered_on ? `${d.registered_on} 등기` : "등기 정보 없음"}</dd>
              {d.apt_dong && (
                <>
                  <dt className="text-slate-500">동</dt>
                  <dd>{d.apt_dong}</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt className="text-slate-500">보증금</dt>
              <dd>{formatKrw(d.deposit)}</dd>
              <dt className="text-slate-500">월세</dt>
              <dd>{d.monthly_rent ? formatKrw(d.monthly_rent) : "없음(전세)"}</dd>
              <dt className="text-slate-500">계약</dt>
              <dd>{[d.contract_type, d.contract_term].filter(Boolean).join(" · ") || "정보 없음"}</dd>
            </>
          )}
          <dt className="text-slate-500">전용면적</dt>
          <dd>{formatArea(d.area_m2)}</dd>
        </dl>
      )}
    </li>
  );
}

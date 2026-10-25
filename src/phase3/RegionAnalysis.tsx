// Phase 3 region analysis page (P3-SCR-001~006): city → legal eup/myeon/dong choropleth with period and
// metric filters, legend with real class ranges, an accessible region table (also the map fallback),
// region detail with monthly counts and traded complexes, and a two-region comparison.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api";
import { formatKrw } from "../format";
import {
  CITY_IDS, fetchRegions, type ApartmentsView, type BoundariesView, type CompareView, type DetailView, type Metric, type Monthly,
  type Period, type PriceStatus, type RegionStat, type StatisticsView,
} from "./api";
import { RegionMap, type RegionStyle } from "./RegionMap";

// Sequential blue ramp (dataviz reference, validated --ordinal on light: monotone, light end 2.06:1).
const RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
const RAMP_FOR: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const UNKNOWN: RegionStyle = { fill: "#94a3b8", opacity: 0.35, dashed: true };
const NO_APTS: RegionStyle = { fill: "#e2e8f0", opacity: 0.3, dashed: true };
const PYEONG = 3.3058;

const STATUS_TEXT: Record<PriceStatus, string> = {
  AVAILABLE: "",
  INSUFFICIENT_SAMPLE: "표본 부족(3건 미만)",
  NO_TRADES: "거래 없음",
  NO_APARTMENTS: "아파트 없음",
  INCOMPLETE_DATA: "수집 누락 — 미확인",
};
const manPerM2 = (won: number) => `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원/㎡`;
const ym = (m: string) => `${m.slice(2, 4)}.${m.slice(4, 6)}`;
const ymd = (d: string) => d.replaceAll("-", ".");

function classColor(cls: number | null | undefined, count: number): string | null {
  if (cls === null || cls === undefined || !count) return null;
  return RAMP[RAMP_FOR[count]![cls]!]!;
}

function valueText(r: RegionStat, metric: Metric): string {
  if (metric === "trade_count") return r.countStatus === "COMPLETE" && r.hasApartments ? `${r.tradeCount.toLocaleString("ko-KR")}건` : STATUS_TEXT[r.priceStatus] || "미확인";
  return r.medianPricePerM2Won !== null ? manPerM2(r.medianPricePerM2Won) : STATUS_TEXT[r.priceStatus];
}

export function RegionAnalysis({ appKey }: { appKey: string | undefined }) {
  const [period, setPeriod] = useState<Period>(24);
  const [metric, setMetric] = useState<Metric>("price_per_m2");
  const [parent, setParent] = useState<keyof typeof CITY_IDS | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [mapFailed, setMapFailed] = useState(false);
  const [boundaries, setBoundaries] = useState<BoundariesView | null>(null);
  const [stats, setStats] = useState<StatisticsView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRegions<BoundariesView>("boundaries", { level: "city" }, ctrl.signal).then(setBoundaries).catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRegions<StatisticsView>("statistics", parent ? { level: "legal_dong", parentRegionId: parent, period, metric } : { level: "city", period, metric }, ctrl.signal)
      .then((s) => {
        setStats(s);
        setState("ready");
      })
      .catch((e) => (e as Error).name !== "AbortError" && setState("error"));
    return () => ctrl.abort();
  }, [parent, period, metric, reload]);

  const onUnavailable = useCallback(() => setMapFailed(true), []);
  const onStale = useCallback(() => {
    setSelected(null);
    setCompare([]);
    setReload((n) => n + 1);
  }, []);

  const byId = useMemo(() => new Map((stats?.regions ?? []).map((r) => [r.regionId, r])), [stats]);
  const features = useMemo(
    () => (boundaries?.features ?? []).filter((f) => !parent || f.properties.cityRegionId === parent),
    [boundaries, parent],
  );
  const classCount = stats?.legend.effectiveClassCount ?? 0;
  const styleOf = useCallback(
    (featureId: string): RegionStyle => {
      // City view: every eup/myeon/dong takes its city's class.
      const f = boundaries?.features.find((x) => x.id === featureId);
      const r = byId.get(parent ? featureId : f?.properties.cityRegionId ?? "");
      if (!r) return UNKNOWN;
      if (!r.hasApartments) return NO_APTS;
      const fill = classColor(r.class, classCount);
      return fill ? { fill, opacity: 0.7, dashed: false } : UNKNOWN;
    },
    [byId, boundaries, parent, classCount],
  );
  const pick = useCallback(
    (id: string) => {
      if (!parent) {
        const city = boundaries?.features.find((f) => f.id === id)?.properties.cityRegionId ?? id;
        if (city in CITY_IDS) {
          setParent(city as keyof typeof CITY_IDS);
          setSelected(null);
        }
        return;
      }
      setSelected(id);
    },
    [parent, boundaries],
  );

  const ds = stats?.dataStatus;
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 pb-10 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <a href="#/" className="text-sm text-sky-700">← 돌아가기</a>
          <h1 className="mt-1 text-lg font-semibold">지역 분석</h1>
          <nav aria-label="지역 단계" className="mt-1 flex items-center gap-1 text-sm">
            <button type="button" onClick={() => { setParent(null); setSelected(null); }} className={parent ? "text-sky-700 underline" : "font-medium"}>
              제주 전체
            </button>
            {parent && (
              <>
                <span aria-hidden="true" className="text-slate-400">›</span>
                <span className="font-medium">{CITY_IDS[parent]}</span>
              </>
            )}
          </nav>
          <div className="mt-2 grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-xs" role="radiogroup" aria-label="분석 기간">
            {([12, 24, 36] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)}
                className={`rounded-md py-1.5 ${period === p ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
                최근 {p}개월
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs" role="radiogroup" aria-label="지도 지표">
            {(["price_per_m2", "trade_count"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)}
                className={`rounded-md py-1.5 ${metric === m ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
                {m === "price_per_m2" ? "㎡당 중위가격" : "거래량"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pt-3">
        {ds?.freshness === "STALE" && <Notice>데이터 갱신이 48시간 넘게 지연되고 있습니다. 마지막 정상 데이터를 표시합니다.</Notice>}
        {ds && ds.missingMonths.length > 0 && <Notice>{ds.missingMonths.map(ym).join(", ")} 데이터를 수집하지 못해 해당 시의 통계는 '미확인'으로 표시합니다.</Notice>}
        {mapFailed && <Notice>지도를 불러올 수 없어 지역 표로 보여 드립니다.</Notice>}

        {!mapFailed && (
          <div className="relative h-[46vh] min-h-64 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <RegionMap appKey={appKey} features={features} styleOf={styleOf} selectedId={selected} onSelect={pick} onUnavailable={onUnavailable} />
          </div>
        )}
        {stats && <LegendView stats={stats} metric={metric} />}

        {state === "error" && (
          <div className="py-6 text-center text-sm" role="alert">
            <p className="text-red-700">지역 통계를 불러올 수 없습니다.</p>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1">다시 시도</button>
          </div>
        )}
        {state === "loading" && !stats && <p className="py-6 text-center text-sm text-slate-500">지역 통계를 불러오는 중…</p>}

        {stats && parent && selected && byId.get(selected) && (
          <RegionDetail
            key={`${selected}:${period}:${stats.snapshotId}`}
            regionId={selected}
            period={period}
            snapshotId={stats.snapshotId}
            inCompare={compare.includes(selected)}
            onCompare={() => setCompare((c) => (c.includes(selected) ? c : [...c, selected].slice(-2)))}
            onStale={onStale}
          />
        )}
        {stats && compare.length === 2 && (
          <ComparePanel ids={compare} period={period} snapshotId={stats.snapshotId} onClear={() => setCompare([])} onStale={onStale} />
        )}
        {stats && compare.length === 1 && (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">비교할 지역을 하나 더 선택해 "비교에 추가"를 누르세요. ({byId.get(compare[0]!)?.name ?? "선택됨"})</p>
        )}

        {stats && (
          <RegionTable stats={stats} metric={metric} selectedId={selected} classCount={classCount}
            onPick={(id) => (parent ? setSelected(id) : pick(id))} drill={!parent} />
        )}
        {stats && (
          <footer className="mt-6 space-y-1 text-[11px] leading-4 text-slate-500">
            <p>기간 {ymd(stats.contractPeriod.startInclusive)} ~ {ymd(stats.contractPeriod.endExclusive)} 전날까지(계약일 기준), 이번 달({ym(ds!.currentMonth)})은 신고 기한 때문에 잠정입니다.</p>
            <p>가격은 확정된 단지의 유효 매매만으로 거래별 '가격 ÷ 전용면적'의 중앙값을 계산하며, 3건 미만이면 표시하지 않습니다. 해제 거래는 제외합니다.</p>
            <p>1년 전 대비는 최근 12개월과 직전 12개월의 중앙값 비교로, 실제 가격 변동 외에도 그 기간에 거래된 단지·면적 구성의 차이에 따라 크게 달라질 수 있습니다.</p>
            {parent && stats.unmapped[parent.slice(0, 5)] && stats.unmapped[parent.slice(0, 5)]!.total > stats.unmapped[parent.slice(0, 5)]!.mapped && (
              <p>단지를 확정하지 못한 거래 {(stats.unmapped[parent.slice(0, 5)]!.total - stats.unmapped[parent.slice(0, 5)]!.mapped).toLocaleString("ko-KR")}건은 읍면동 통계에서 제외했습니다.</p>
            )}
            <p>출처: 국토교통부 실거래가 공개시스템, 국토교통부 법정동 코드·법정구역 경계. 데이터 버전 {stats.snapshotId}</p>
            {ds?.lastSuccessfulSyncAt && <p>마지막 데이터 갱신: {new Date(ds.lastSuccessfulSyncAt).toLocaleString("ko-KR")}</p>}
          </footer>
        )}
      </main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{children}</p>;
}

function LegendView({ stats, metric }: { stats: StatisticsView; metric: Metric }) {
  const fmt = (v: number) => (metric === "price_per_m2" ? `${Math.round(v / 10_000).toLocaleString("ko-KR")}` : v.toLocaleString("ko-KR"));
  const unit = metric === "price_per_m2" ? "만원/㎡" : "건";
  const n = stats.legend.effectiveClassCount;
  return (
    <section aria-label="범례" className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {stats.legend.classes.map((c) => (
          <li key={c.index} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm" style={{ background: classColor(c.index, n)! }} />
            {fmt(c.min)}{c.max !== c.min ? `~${fmt(c.max)}` : ""}{unit} ({c.count}곳)
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-500" style={{ background: "#94a3b859" }} />
          표본 부족·미확인
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-100" />
          아파트 없음
        </li>
      </ul>
      <p className="mt-1 leading-4">
        {n ? `대상 ${stats.legend.eligibleRegionCount}곳을 값 순서로 ${n}단계 구분(같은 값은 같은 단계). 지역 범위·기간·지표가 바뀌면 단계가 다시 나뉩니다.` : "색으로 구분할 수 있는 지역이 없습니다."}
      </p>
    </section>
  );
}

function RegionTable(props: { stats: StatisticsView; metric: Metric; selectedId: string | null; classCount: number; onPick: (id: string) => void; drill: boolean }) {
  const { stats, metric, selectedId, classCount, onPick, drill } = props;
  const value = (r: RegionStat) => (metric === "price_per_m2" ? r.medianPricePerM2Won : r.countStatus === "COMPLETE" && r.hasApartments ? r.tradeCount : null);
  const rows = [...stats.regions].sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1) || a.name.localeCompare(b.name, "ko"));
  return (
    <section className="mt-3" aria-label="지역 표">
      <h2 className="text-sm font-medium">{drill ? "시별" : "읍면동별"} {metric === "price_per_m2" ? "㎡당 중위가격" : "거래량"}</h2>
      <table className="mt-1 w-full table-fixed border-collapse rounded-lg bg-white text-left text-xs">
        <thead className="text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="w-[34%] px-2 py-1.5 font-normal">지역</th>
            <th className="w-[36%] px-2 font-normal">{metric === "price_per_m2" ? "㎡당 중위가격" : "거래량"}</th>
            <th className="px-2 font-normal">거래·변화</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = classColor(r.class, classCount);
            return (
              <tr key={r.regionId} className={`border-b border-slate-100 ${selectedId === r.regionId ? "bg-sky-50" : ""}`}>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => onPick(r.regionId)} className="flex w-full items-center gap-1.5 text-left text-sky-800 underline-offset-2 hover:underline" aria-current={selectedId === r.regionId}>
                    <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${color ? "" : "border border-dashed border-slate-400"}`} style={{ background: color ?? "transparent" }} />
                    <span className="truncate">{r.name}</span>
                  </button>
                </td>
                <td className="px-2 tabular-nums">{valueText(r, metric)}</td>
                <td className="px-2 tabular-nums text-slate-600">
                  {r.hasApartments ? `${r.tradeCount}건` : "-"}
                  {r.change.pct !== null && <span className="ml-1">{r.change.pct > 0 ? "▲" : r.change.pct < 0 ? "▼" : ""}{Math.abs(r.change.pct).toFixed(1)}%</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drill && <p className="mt-1 text-[11px] text-slate-500">시를 누르면 읍면동 지도로 이동합니다.</p>}
    </section>
  );
}

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], onStale: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal)
      .then(setData)
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof ApiError && e.status === 409) onStale();
        else setFailed(true);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, failed };
}

function RegionDetail(props: { regionId: string; period: Period; snapshotId: string; inCompare: boolean; onCompare: () => void; onStale: () => void }) {
  const { regionId, period, snapshotId, inCompare, onCompare, onStale } = props;
  const { data: d, failed } = useLoad((s) => fetchRegions<DetailView>("detail", { regionId, period, snapshotId }, s), [regionId, period, snapshotId], onStale);
  const [pages, setPages] = useState<ApartmentsView[]>([]);
  const [aptFailed, setAptFailed] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchRegions<ApartmentsView>("apartments", { regionId, period, pageSize: 10, snapshotId }, ctrl.signal)
      .then((p) => setPages([p]))
      .catch((e) => (e instanceof ApiError && e.status === 409 ? onStale() : (e as Error).name !== "AbortError" && setAptFailed(true)));
    return () => ctrl.abort();
  }, [regionId, period, snapshotId, onStale]);
  const more = () => {
    const next = pages.at(-1)?.nextCursor;
    if (!next) return;
    fetchRegions<ApartmentsView>("apartments", { regionId, period, pageSize: 10, cursor: next })
      .then((p) => setPages((ps) => [...ps, p]))
      .catch((e) => (e instanceof ApiError && e.status === 409 ? onStale() : setAptFailed(true)));
  };

  if (failed) return <p className="mt-3 text-sm text-red-700" role="alert">지역 정보를 불러올 수 없습니다.</p>;
  if (!d) return <p className="mt-3 text-sm text-slate-500">지역 정보를 불러오는 중…</p>;
  const r = d.region;
  const items = pages.flatMap((p) => p.items);
  return (
    <section className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-3" aria-label={`${r.name} 상세`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{r.name}</h2>
          <p className="text-[11px] text-slate-500">{ymd(d.contractPeriod.startInclusive)} ~ {ymd(d.contractPeriod.endExclusive)} 전날 · 최근 {period}개월</p>
        </div>
        <button type="button" onClick={onCompare} disabled={inCompare} className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
          {inCompare ? "비교 목록에 있음" : "비교에 추가"}
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <Stat label="㎡당 중위가격" value={r.medianPricePerM2Won !== null ? manPerM2(r.medianPricePerM2Won) : "-"}
          sub={r.medianPricePerM2Won !== null ? `평당 ${formatKrw(r.medianPricePerM2Won * PYEONG)}` : STATUS_TEXT[r.priceStatus]} />
        <Stat label="거래" value={r.hasApartments ? `${r.tradeCount.toLocaleString("ko-KR")}건` : "-"} sub={r.countStatus === "INCOMPLETE" ? "수집 누락 포함 — 미확인" : r.hasApartments ? "확정 단지 유효 매매" : "아파트 없음"} />
        <Stat label="1년 전 대비" value={r.change.pct !== null ? `${r.change.pct > 0 ? "▲ +" : r.change.pct < 0 ? "▼ " : ""}${r.change.pct.toFixed(1)}%` : "-"}
          sub={r.change.status === "AVAILABLE" ? "최근 12개월 vs 직전 12개월, 거래 단지 구성에 따라 크게 달라질 수 있음" : `표본 부족(최근 ${r.change.recentCount}건·직전 ${r.change.previousCount}건, 각 3건 필요)`} />
        <Stat label="데이터" value={d.dataStatus.freshness === "STALE" ? "갱신 지연" : "정상"} sub={`이번 달(${ym(d.dataStatus.currentMonth)}) 잠정`} />
      </dl>
      <MonthlyBars monthly={d.monthly} />
      <h3 className="mt-3 text-sm font-medium">거래된 단지</h3>
      {aptFailed && <p className="text-xs text-slate-600">단지 목록을 불러오지 못했습니다.</p>}
      {items.length === 0 && !aptFailed && <p className="text-xs text-slate-500">기간 중 거래된 단지가 없습니다.</p>}
      <ul className="mt-1 divide-y divide-slate-100">
        {items.map((a) => (
          <li key={a.apartmentId}>
            <a href={a.links.detail} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-sky-800">{a.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{a.address ?? ""}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-slate-600 tabular-nums">
                {a.tradeCount}건<br />최근 {ymd(a.lastContractDate)}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {pages.at(-1)?.nextCursor && (
        <button type="button" onClick={more} className="mt-2 w-full rounded-lg border border-slate-300 py-1.5 text-xs">단지 더 보기</button>
      )}
      {items.some((a) => a.links.priceAnalysis) && <p className="mt-2 text-[11px] text-slate-500">단지를 누르면 상세로 이동합니다. 면적별 가격 추이는 상세의 "가격 분석" 탭에서 볼 수 있습니다.</p>}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      <dd className="text-[11px] leading-4 text-slate-500">{sub}</dd>
    </div>
  );
}

function MonthlyBars({ monthly }: { monthly: Monthly }) {
  const max = Math.max(1, ...monthly.map((m) => m.tradeCount ?? 0));
  const w = 100 / monthly.length;
  return (
    <figure className="mt-3">
      <figcaption className="text-[11px] text-slate-500">월별 거래량(빗금: 수집 누락, 흐림: 이번 달 잠정)</figcaption>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 h-16 w-full" role="img" aria-label={`월별 거래량 ${monthly.length}개월`}>
        <defs>
          <pattern id="p3-missing" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="2" stroke="#94a3b8" strokeWidth="0.6" />
          </pattern>
        </defs>
        {monthly.map((m, i) => {
          const h = m.tradeCount === null ? 30 : (m.tradeCount / max) * 28;
          return (
            <rect key={m.contractMonth} x={i * w + w * 0.15} y={30 - h} width={w * 0.7} height={h}
              fill={m.tradeCount === null ? "url(#p3-missing)" : "#2a78d6"} opacity={m.isCurrentMonth ? 0.45 : 1}>
              <title>{`${ym(m.contractMonth)} ${m.tradeCount === null ? "미수집" : `${m.tradeCount}건`}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{ym(monthly[0]!.contractMonth)}</span>
        <span>최대 {max}건</span>
        <span>{ym(monthly.at(-1)!.contractMonth)}</span>
      </div>
    </figure>
  );
}

function ComparePanel(props: { ids: string[]; period: Period; snapshotId: string; onClear: () => void; onStale: () => void }) {
  const { ids, period, snapshotId, onClear, onStale } = props;
  const { data, failed } = useLoad((s) => fetchRegions<CompareView>("compare", { regionIds: ids.join(","), period, snapshotId }, s), [ids.join(","), period, snapshotId], onStale);
  return (
    <section className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-3" aria-label="두 지역 비교">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">두 지역 비교 · 최근 {period}개월</h2>
        <button type="button" onClick={onClear} className="text-xs text-sky-700">비교 지우기</button>
      </div>
      {failed && <p className="text-xs text-red-700">비교 정보를 불러올 수 없습니다.</p>}
      {data && (
        <table className="mt-1 w-full table-fixed text-left text-xs">
          <thead className="text-slate-500">
            <tr><th className="py-1 font-normal">항목</th>{data.regions.map((r) => <th key={r.regionId} className="font-medium text-slate-800">{r.name}</th>)}</tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-slate-100"><td className="py-1 text-slate-500">㎡당 중위가격</td>{data.regions.map((r) => <td key={r.regionId}>{r.medianPricePerM2Won !== null ? manPerM2(r.medianPricePerM2Won) : STATUS_TEXT[r.priceStatus]}</td>)}</tr>
            <tr className="border-t border-slate-100"><td className="py-1 text-slate-500">거래</td>{data.regions.map((r) => <td key={r.regionId}>{r.hasApartments ? `${r.tradeCount}건` : "아파트 없음"}{r.countStatus === "INCOMPLETE" ? " (미확인)" : ""}</td>)}</tr>
            <tr className="border-t border-slate-100"><td className="py-1 text-slate-500">1년 전 대비</td>{data.regions.map((r) => <td key={r.regionId}>{r.change.pct !== null ? `${r.change.pct > 0 ? "+" : ""}${r.change.pct.toFixed(1)}%` : "표본 부족"}</td>)}</tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

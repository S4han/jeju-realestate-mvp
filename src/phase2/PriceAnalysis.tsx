// Phase 2 price analysis (P2-SCR-001~006): period/area filters, summary cards, deal-dot price chart with a
// quarterly median line, monthly volume bars and evidence deals. Rendered only inside the flag-guarded tab.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api";
import { formatArea, formatFloor, formatKrw } from "../format";
import {
  fetchAnalysis, type AreaSel, type AreasView, type Deal, type EvidenceView, type MonthlyView, type Period, type PointsView,
  type PriceStatus, type SummaryView,
} from "./api";

// Categorical slots 1 and 2, validated for light mode (dataviz validate_palette.js: all checks pass).
const SERIES_DEAL = "#2a78d6";
const SERIES_MEDIAN = "#eb6834";
const PYEONG_M2 = 3.3058;
const PERIOD_OPTIONS: Period[] = [12, 24, 36];

const ym = (m: string) => `${m.slice(0, 4)}.${m.slice(4, 6)}`;

// Axis/compact price: 520,000,000 → "5.2억", 98,000,000 → "9,800만".
export function formatEokShort(won: number): string {
  if (won >= 100_000_000) return `${(won / 100_000_000).toFixed(won % 100_000_000 === 0 ? 0 : 1)}억`;
  return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만`;
}

const STATUS_REASON: Record<PriceStatus, string> = {
  AVAILABLE: "",
  INSUFFICIENT_SAMPLE: "거래 3건 미만이라 계산하지 않음",
  NO_TRADES: "기간 내 거래 없음",
  INCOMPLETE_DATA: "수집하지 못한 달이 있어 계산하지 않음",
  UNAVAILABLE: "전체 면적은 면적이 섞여 가격을 표시하지 않음",
};

type Loaded = { areas: AreasView; summary: SummaryView; monthly: MonthlyView; points: PointsView | null; evidence: EvidenceView | null; evidenceError: boolean };

export function PriceAnalysis({ id }: { id: string }) {
  const [period, setPeriod] = useState<Period>(24);
  const [area, setArea] = useState<AreaSel | null>(null); // null = server default
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const s = ctrl.signal;
    setState("loading");
    const load = async (): Promise<Loaded> => {
      const areas = await fetchAnalysis<AreasView>(id, "areas", { period, ...(area === null ? {} : { areaType: area }) }, s);
      const areaType: AreaSel = area ?? areas.defaultAreaTypeM2 ?? "all";
      const q = { period, areaType };
      const [summary, monthly, points, evidence] = await Promise.all([
        fetchAnalysis<SummaryView>(id, "summary", q, s),
        fetchAnalysis<MonthlyView>(id, "monthly", q, s),
        areaType === "all" ? null : fetchAnalysis<PointsView>(id, "points", q, s),
        areaType === "all" ? null : fetchAnalysis<EvidenceView>(id, "transactions", { ...q, pageSize: 20 }, s).catch((e) => (e instanceof ApiError ? e : Promise.reject(e))),
      ]);
      const ev = evidence instanceof ApiError ? null : evidence;
      // Every part of the screen must come from one data version (PRD 6절); a refresh in between reloads.
      const versions = new Set([areas, summary, monthly, points, ev].filter((v) => v !== null).map((v) => v!.dataVersion));
      if (versions.size > 1) throw new Error("VERSION_MIXED");
      return { areas, summary, monthly, points, evidence: ev, evidenceError: evidence instanceof ApiError };
    };
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const d = await load();
          setData(d);
          setState("ready");
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          if ((e as Error).message !== "VERSION_MIXED") break;
        }
      }
      if (!s.aborted) setState("error");
    })();
    return () => ctrl.abort();
  }, [id, period, area, retry]);

  const areaType = data?.summary.areaTypeM2 ?? area;
  // A chosen type with no deals in a shorter period stays selectable so the user sees "no deals", not a jump.
  const chips = [...new Set([...(data?.areas.areas ?? []).map((a) => a.areaTypeM2), ...(typeof areaType === "number" ? [areaType] : [])])].sort((a, b) => a - b);

  return (
    <section aria-label="가격 분석" className="space-y-3">
      <div className="space-y-2">
        <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-xs" role="radiogroup" aria-label="분석 기간">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-md py-1.5 ${period === p ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}
            >
              최근 {p}개월
            </button>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto" aria-label="면적 유형">
          {[...chips, "all" as const].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={areaType === m}
              onClick={() => setArea(m)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${areaType === m ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white"}`}
            >
              {m === "all" ? "전체(거래량만)" : `${m}㎡대`}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && !data && <p className="py-8 text-center text-sm text-slate-500">가격 분석을 불러오는 중…</p>}
      {state === "error" && (
        <div className="py-8 text-center text-sm" role="alert">
          <p className="text-red-700">가격 분석을 불러올 수 없습니다. 매매 목록은 계속 이용할 수 있습니다.</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1">
            다시 시도
          </button>
        </div>
      )}
      {data && state !== "error" && (
        <div className={state === "loading" ? "opacity-60" : ""} aria-busy={state === "loading"}>
          <Notices data={data} />
          <SummaryCards s={data.summary} />
          {data.points ? (
            <PriceChart points={data.points} monthly={data.monthly} />
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
              전체 면적은 서로 다른 면적의 가격이 섞이므로 가격 그래프를 표시하지 않습니다. 면적 유형을 고르면 가격을 볼 수 있습니다.
            </p>
          )}
          <VolumeChart monthly={data.monthly} />
          {data.points && <Evidence id={id} first={data.evidence} failed={data.evidenceError} onRestart={() => setRetry((n) => n + 1)} />}
        </div>
      )}
    </section>
  );
}

function Notices({ data }: { data: Loaded }) {
  const ds = data.summary.dataStatus;
  const notes: ReactNode[] = [];
  if (ds.missingMonths.length) notes.push(`${ds.missingMonths.map(ym).join(", ")} 데이터를 수집하지 못했습니다. 해당 달은 '미수집'으로 표시하며 가격 통계에서 제외합니다.`);
  if (ds.partialMonths.length) notes.push(`${ds.partialMonths.map(ym).join(", ")} 데이터는 일부만 수집되었습니다.`);
  if (ds.freshness === "STALE") notes.push("데이터 갱신이 지연되고 있습니다. 마지막 정상 데이터를 표시합니다.");
  return (
    <>
      {notes.map((n, i) => (
        <p key={i} role="alert" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {n}
        </p>
      ))}
    </>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{sub}</p>}
    </div>
  );
}

function SummaryCards({ s: v }: { s: SummaryView }) {
  const s = v.summary;
  const perM2 = s.medianPricePerM2Won;
  const yoy = s.yearOverYearChangePct;
  const comp = v.comparison;
  const yoySub =
    s.comparisonStatus === "AVAILABLE"
      ? "최근 12개월 중위 vs 직전 12개월"
      : s.comparisonStatus === "INSUFFICIENT_SAMPLE"
        ? `표본 부족(최근 ${comp.recentTradeCount ?? 0}건·직전 ${comp.previousTradeCount ?? 0}건, 각 3건 이상 필요)`
        : STATUS_REASON[s.comparisonStatus];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Card label={`거래 ${v.periodMonths}개월`} value={`${s.tradeCount.toLocaleString("ko-KR")}건`} sub={v.areaTypeM2 === "all" ? "모든 면적 합계" : `${v.areaTypeM2}㎡대`} />
      <Card
        label="중위 거래가"
        value={s.medianPriceWon === null ? "-" : formatKrw(s.medianPriceWon)}
        sub={perM2 === null ? STATUS_REASON[s.priceStatus] : `㎡당 ${formatKrw(perM2)} · 평당 ${formatKrw(perM2 * PYEONG_M2)}`}
      />
      <Card
        label="최저 / 최고"
        value={s.minPriceWon === null || s.maxPriceWon === null ? "-" : `${formatEokShort(s.minPriceWon)} / ${formatEokShort(s.maxPriceWon)}`}
        sub={s.minPriceWon === null ? STATUS_REASON[s.tradeCount === 0 ? "NO_TRADES" : s.priceStatus] : `거래 ${s.tradeCount}건 기준${s.tradeCount < 3 ? "(표본 적음)" : ""}`}
      />
      <Card label="1년 전 대비" value={yoy === null ? "-" : `${yoy > 0 ? "▲ +" : yoy < 0 ? "▼ " : ""}${yoy.toFixed(1)}%`} sub={yoySub} />
    </div>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const toTime = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const monthStart = (m: string) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(4, 6)) - 1, 1);

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || max || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x - 80, 0), width - 160);
  return (
    <div role="status" className="pointer-events-none absolute z-10 w-40 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-800 shadow-md" style={{ left, top: Math.max(tip.y - 64, 0) }}>
      {tip.lines.map((l, i) => (
        <p key={i} className={i === 0 ? "font-medium" : "text-slate-600"}>
          {l}
        </p>
      ))}
    </div>
  );
}

function ChartFrame({ title, legend, children, table }: { title: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {legend}
      {children}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer py-1 text-sky-700">표로 보기</summary>
        <div className="max-h-64 overflow-auto">{table}</div>
      </details>
    </figure>
  );
}

function PriceChart({ points, monthly }: { points: PointsView; monthly: MonthlyView }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const h = 200;
  const m = { l: 40, r: 8, t: 8, b: 22 };
  const months = monthly.monthly.map((x) => x.contractMonth);
  const x0 = monthStart(months[0]!);
  const last = months.at(-1)!;
  const x1 = Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)), 1);
  const quarters = monthly.quarterly;
  const prices = [...points.points.map((p) => p.priceWon), ...quarters.flatMap((q) => (q.medianPriceWon === null ? [] : [q.medianPriceWon]))];
  const ticks = prices.length ? niceTicks(Math.min(...prices) * 0.95, Math.max(...prices) * 1.02) : [0, 1];
  const y0 = ticks[0]!;
  const y1 = ticks.at(-1)!;
  const sx = (t: number) => m.l + ((t - x0) / (x1 - x0)) * (width - m.l - m.r);
  const sy = (v: number) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
  const xLabels = months.filter((_, i) => i % (months.length > 12 ? 6 : 3) === 0);

  // Quarter midpoints; the line breaks at quarters without a median (never drawn through gaps or zero).
  const qMid = (q: string) => {
    const y = Number(q.slice(0, 4));
    const qn = Number(q.slice(5));
    return (Date.UTC(y, (qn - 1) * 3, 1) + Date.UTC(y, qn * 3, 1)) / 2;
  };
  const segments: string[] = [];
  let cur: string[] = [];
  for (const q of quarters) {
    if (q.medianPriceWon === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
      continue;
    }
    const t = Math.min(Math.max(qMid(q.quarter), x0), x1);
    cur.push(`${cur.length ? "L" : "M"}${sx(t).toFixed(1)},${sy(q.medianPriceWon).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur.join(" "));
  const singleQuarterDots = segments.filter((s) => !s.includes("L"));

  const dealLines = (p: Deal) => [
    formatKrw(p.priceWon),
    `${p.contractDate} · ${formatFloor(p.floor)}`,
    formatArea(p.areaM2),
    ...(p.sameConditionCount > 1 ? [`같은 날·면적·층·가격 거래 ${p.sameConditionCount}건`] : []),
  ];

  const legend = (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600" aria-label="범례">
      <li className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true">
          <circle cx="5" cy="5" r="4" fill={SERIES_DEAL} />
        </svg>
        개별 거래 {points.points.length}건
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="16" y2="5" stroke={SERIES_MEDIAN} strokeWidth="2" />
        </svg>
        분기 중위가격(분기 3건 이상)
      </li>
    </ul>
  );

  const table = (
    <table className="w-full text-left tabular-nums">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 font-normal">분기</th>
          <th className="font-normal">거래</th>
          <th className="font-normal">중위가격</th>
        </tr>
      </thead>
      <tbody>
        {quarters.map((q) => (
          <tr key={q.quarter} className="border-t border-slate-100">
            <td className="py-1">{q.quarter.replace("Q", "년 ")}분기</td>
            <td>{q.tradeCount}건</td>
            <td>{q.medianPriceWon === null ? STATUS_REASON[q.priceStatus] : formatKrw(q.medianPriceWon)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title="가격 추이" legend={legend} table={table}>
      <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
        {points.points.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">선택한 기간·면적에 거래가 없습니다.</p>
        ) : (
          <svg width={width} height={h} role="img" aria-label={`가격 추이: 개별 거래 ${points.points.length}건과 분기 중위가격. 자세한 값은 표로 보기에서 확인할 수 있습니다.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth="1" />
                <text x={m.l - 4} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
                  {formatEokShort(t)}
                </text>
              </g>
            ))}
            {xLabels.map((mm) => (
              <text key={mm} x={sx(monthStart(mm))} y={h - 6} fontSize="10" fill="#64748b" textAnchor="start">
                {ym(mm).slice(2)}
              </text>
            ))}
            {segments.map((d, i) => (
              <path key={i} d={d} fill="none" stroke={SERIES_MEDIAN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {singleQuarterDots.map((d, i) => {
              const [cx, cy] = d.slice(1).split(",").map(Number);
              return <rect key={i} x={cx! - 8} y={cy! - 1} width="16" height="2" fill={SERIES_MEDIAN} />;
            })}
            {points.points.map((p) => {
              const cx = sx(toTime(p.contractDate) + 43_200_000);
              const cy = sy(p.priceWon);
              const show = () => setTip({ x: cx, y: cy, lines: dealLines(p) });
              return (
                <g key={p.transactionId} onMouseEnter={show} onClick={show}>
                  <circle cx={cx} cy={cy} r="4" fill={SERIES_DEAL} stroke="#ffffff" strokeWidth="2" paintOrder="stroke" />
                  <circle cx={cx} cy={cy} r="11" fill="transparent" />
                </g>
              );
            })}
          </svg>
        )}
        <Tooltip tip={tip} width={width} />
      </div>
      {points.truncated && <p className="text-[11px] text-slate-500">거래가 많아 최근 거래 위주로 일부만 점으로 표시했습니다.</p>}
    </ChartFrame>
  );
}

function VolumeChart({ monthly }: { monthly: MonthlyView }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const rows = monthly.monthly;
  const h = 140;
  const m = { l: 28, r: 8, t: 8, b: 22 };
  const maxN = Math.max(1, ...rows.map((r) => r.tradeCount ?? 0));
  const ticks = niceTicks(0, maxN, 3).filter((t) => Number.isInteger(t));
  const top = ticks.at(-1)!;
  const slot = (width - m.l - m.r) / rows.length;
  const bw = Math.min(24, Math.max(3, slot - 2));
  const sy = (v: number) => m.t + (1 - v / top) * (h - m.t - m.b);
  const base = sy(0);
  const every = rows.length > 12 ? 6 : 3;
  const missing = rows.filter((r) => r.collectionStatus === "MISSING").length;

  const describe = (r: (typeof rows)[number]) =>
    r.collectionStatus === "MISSING"
      ? "미수집(거래 수 알 수 없음)"
      : `${r.tradeCount}건${r.collectionStatus === "PARTIAL" ? " · 일부만 수집" : ""}${r.isCurrentMonth ? " · 이번 달(잠정)" : ""}`;

  const table = (
    <table className="w-full text-left tabular-nums">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 font-normal">계약월</th>
          <th className="font-normal">거래량</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.contractMonth} className="border-t border-slate-100">
            <td className="py-1">{ym(r.contractMonth)}</td>
            <td>{describe(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title="월별 거래량" table={table}>
      <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
        <svg width={width} height={h} role="img" aria-label={`월별 거래량 ${rows.length}개월${missing ? `, 미수집 ${missing}개월` : ""}. 자세한 값은 표로 보기에서 확인할 수 있습니다.`}>
          <defs>
            <pattern id="p2-missing" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" strokeWidth="1" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={m.l - 4} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
                {t}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = m.l + slot * i + slot / 2;
            const show = () => setTip({ x: cx, y: sy(r.tradeCount ?? 0), lines: [ym(r.contractMonth), describe(r)] });
            const n = r.tradeCount ?? 0;
            const y = sy(n);
            const rr = Math.min(4, bw / 2, base - y);
            return (
              <g key={r.contractMonth} onMouseEnter={show} onClick={show}>
                {r.collectionStatus === "MISSING" ? (
                  <rect x={cx - bw / 2} y={m.t} width={bw} height={base - m.t} fill="url(#p2-missing)" opacity="0.6" />
                ) : (
                  n > 0 && (
                    <path
                      d={`M${cx - bw / 2},${base} V${y + rr} Q${cx - bw / 2},${y} ${cx - bw / 2 + rr},${y} H${cx + bw / 2 - rr} Q${cx + bw / 2},${y} ${cx + bw / 2},${y + rr} V${base} Z`}
                      fill={SERIES_DEAL}
                      opacity={r.isCurrentMonth || r.collectionStatus === "PARTIAL" ? 0.45 : 1}
                    />
                  )
                )}
                <rect x={m.l + slot * i} y={m.t} width={slot} height={base - m.t} fill="transparent" />
                {i % every === 0 && (
                  <text x={cx} y={h - 6} fontSize="10" fill="#64748b" textAnchor="middle">
                    {ym(r.contractMonth).slice(2)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={m.l} x2={width - m.r} y1={base} y2={base} stroke="#94a3b8" strokeWidth="1" />
        </svg>
        <Tooltip tip={tip} width={width} />
      </div>
      <p className="text-[11px] leading-4 text-slate-500">
        흐린 막대는 이번 달(신고 기한 30일로 늘어날 수 있음) 또는 일부만 수집된 달{missing ? ", 빗금은 수집하지 못한 달(0건이 아님)" : ""}입니다.
      </p>
    </ChartFrame>
  );
}

function Evidence({ id, first, failed, onRestart }: { id: string; first: EvidenceView | null; failed: boolean; onRestart: () => void }) {
  const [pages, setPages] = useState<EvidenceView[]>(first ? [first] : []);
  const [err, setErr] = useState<"none" | "changed" | "failed">("none");
  useEffect(() => {
    setPages(first ? [first] : []);
    setErr("none");
  }, [first]);
  const items = pages.flatMap((p) => p.items);
  const next = pages.at(-1)?.nextCursor ?? null;
  const total = first?.tradeCount ?? 0;
  const more = () => {
    if (!first || !next) return;
    fetchAnalysis<EvidenceView>(id, "transactions", { period: first.periodMonths, areaType: first.areaTypeM2, pageSize: 20, cursor: next })
      .then((p) => setPages((ps) => [...ps, p]))
      .catch((e) => setErr(e instanceof ApiError && e.status === 409 ? "changed" : "failed"));
  };

  return (
    <section className="mt-3" aria-label="근거 거래">
      <h2 className="text-sm font-medium">근거 거래 {first ? `${total}건` : ""}</h2>
      <p className="text-[11px] text-slate-500">위 통계와 그래프 점은 아래 거래로 계산했습니다(해제 거래 제외, 단지 연결 확인 거래만).</p>
      {failed && <p className="mt-2 text-xs text-slate-600">근거 거래 목록을 지금 불러올 수 없습니다. 매매 탭에서 거래를 확인할 수 있습니다.</p>}
      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((d) => (
            <li key={d.transactionId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium tabular-nums">{formatKrw(d.priceWon)}</span>
                <span className="block text-xs text-slate-500">
                  {formatArea(d.areaM2)} · {formatFloor(d.floor)}
                  {d.sameConditionCount > 1 && ` · 같은 조건 ${d.sameConditionCount}건`}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">{d.contractDate}</span>
            </li>
          ))}
        </ul>
      )}
      {err === "changed" && (
        <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          데이터가 갱신되었습니다.{" "}
          <button type="button" onClick={onRestart} className="underline">
            처음부터 다시 보기
          </button>
        </p>
      )}
      {err === "failed" && <p className="mt-2 text-xs text-red-700">다음 거래를 불러오지 못했습니다.</p>}
      {next && err === "none" && (
        <button type="button" onClick={more} className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm">
          더 보기 ({items.length}/{total})
        </button>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { fetchTopApartments, type CityCode, type TopApartment, type TopApartments } from "../api";
import { CITY_LABEL, displayAddress, formatArea, formatFloor, formatKrw } from "../format";

type Metric = "price" | "per_pyeong";
const METRIC_LABEL: Record<Metric, string> = { price: "최고 매매가", per_pyeong: "평당가" };
const CITIES: CityCode[] = ["50110", "50130"];

// First screen (TASK-010): most expensive complexes per city, by top sale price or price per pyeong.
export function Dashboard() {
  const [data, setData] = useState<TopApartments | null>(null);
  const [error, setError] = useState(false);
  const [metric, setMetric] = useState<Metric>("price");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(false);
    fetchTopApartments(ctrl.signal)
      .then(setData)
      .catch((e) => (e as Error).name !== "AbortError" && setError(true));
    return () => ctrl.abort();
  }, [attempt]);

  const lists = data ? (metric === "price" ? data.by_price : data.by_per_pyeong) : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm" role="tablist" aria-label="순위 기준">
        {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={metric === m}
            onClick={() => setMetric(m)}
            className={`rounded-md py-1.5 ${metric === m ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          순위를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ml-2 underline">
            다시 시도
          </button>
        </div>
      )}
      {!data && !error && <p className="mt-6 text-center text-sm text-slate-500">불러오는 중…</p>}

      {lists &&
        CITIES.map((city) => (
          <section key={city} aria-label={`${CITY_LABEL[city]} ${METRIC_LABEL[metric]} 순위`} className="mt-5">
            <h2 className="text-base font-semibold">
              {CITY_LABEL[city]} <span className="text-sm font-normal text-slate-500">{METRIC_LABEL[metric]} TOP {data!.top_n}</span>
            </h2>
            {lists[city].length === 0 ? (
              <p className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-500">최근 12개월 확인된 매매 거래가 없습니다.</p>
            ) : (
              <ol className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {lists[city].map((item) => (
                  <RankRow key={item.id} item={item} metric={metric} />
                ))}
              </ol>
            )}
          </section>
        ))}

      {data && (
        <p className="mt-5 text-[11px] leading-4 text-slate-400">
          {data.from.slice(0, 7).replace("-", ".")} 이후 계약된 매매 중 단지와 확실히 연결된 거래만 집계합니다(해제 거래 제외). 단지마다 기준이 가장 높은 거래
          1건으로 순위를 매기며, 평당가는 전용면적 3.3058㎡ 기준입니다. 출처: {data.source}.
        </p>
      )}
    </div>
  );
}

function RankRow({ item, metric }: { item: TopApartment; metric: Metric }) {
  const { deal } = item;
  const headline = metric === "price" ? formatKrw(deal.sale_price) : `평당 ${formatKrw(deal.price_per_pyeong)}`;
  const secondary = metric === "price" ? `평당 ${formatKrw(deal.price_per_pyeong)}` : formatKrw(deal.sale_price);
  return (
    <li>
      <a href={`#/apartments/${item.id}`} className="flex items-start gap-3 px-3 py-3 hover:bg-slate-50">
        <span className="mt-0.5 w-5 shrink-0 text-center text-sm font-semibold text-sky-700">{item.rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{item.name}</span>
            <span className="shrink-0 font-semibold">{headline}</span>
          </span>
          <span className="block truncate text-xs text-slate-500">{displayAddress(item.road_address, item.lot_address)}</span>
          <span className="block text-xs text-slate-600">
            {secondary} · {formatArea(deal.area_m2)} · {formatFloor(deal.floor)} · {deal.contract_date}
          </span>
          <span className="block text-[11px] text-slate-400">최근 12개월 매매 {item.sale_count}건</span>
        </span>
      </a>
    </li>
  );
}

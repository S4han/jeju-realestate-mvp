import { useEffect, useState } from "react";
import { fetchApartment, type ApartmentDetail } from "../api";
import { CITY_LABEL, displayAddress, formatArea, formatFloor, formatKrw, formatRent } from "../format";

type Props = { id: string; onClose: () => void };

// Marker / search selection card (SCR-002). Counts include only confirmed, non-cancelled deals.
export function SummaryCard({ id, onClose }: Props) {
  const [detail, setDetail] = useState<ApartmentDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(false);
    fetchApartment(id, ctrl.signal)
      .then(setDetail)
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError(true);
      });
    return () => ctrl.abort();
  }, [id]);

  return (
    <section
      aria-label="단지 요약"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl rounded-t-2xl border border-slate-200 bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{detail?.name ?? (error ? "불러오기 실패" : "불러오는 중…")}</h2>
          {detail && (
            <p className="text-sm text-slate-600">
              {CITY_LABEL[detail.city_code]} · {displayAddress(detail.road_address, detail.lot_address)}
              {detail.unit_count ? ` · ${detail.unit_count.toLocaleString("ko-KR")}세대` : ""}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
          ✕
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">단지 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.</p>}
      {detail && (
        <>
          {detail.lat === null && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">위치가 검증되지 않아 지도에 표시하지 않는 단지입니다.</p>}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2">
              <dt className="text-xs text-slate-500">최근 12개월 매매</dt>
              <dd className="font-medium">{detail.recent.sale_count}건</dd>
              {detail.recent.last_sale ? (
                <dd className="mt-1 text-xs text-slate-600">
                  최근 {formatKrw(detail.recent.last_sale.sale_price)}
                  <br />
                  {detail.recent.last_sale.contract_date} · {formatArea(detail.recent.last_sale.area_m2)} · {formatFloor(detail.recent.last_sale.floor)}
                </dd>
              ) : (
                <dd className="mt-1 text-xs text-slate-500">확인된 거래 없음</dd>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <dt className="text-xs text-slate-500">최근 12개월 전월세</dt>
              <dd className="font-medium">{detail.recent.rent_count}건</dd>
              {detail.recent.last_rent ? (
                <dd className="mt-1 text-xs text-slate-600">
                  최근 {formatRent(detail.recent.last_rent.deposit, detail.recent.last_rent.monthly_rent)}
                  <br />
                  {detail.recent.last_rent.contract_date} · {formatArea(detail.recent.last_rent.area_m2)}
                </dd>
              ) : (
                <dd className="mt-1 text-xs text-slate-500">확인된 거래 없음</dd>
              )}
            </div>
          </dl>
          <a
            href={`#/apartments/${detail.id}`}
            className="mt-3 block rounded-lg bg-sky-700 py-2 text-center text-sm font-medium text-white hover:bg-sky-800"
          >
            거래 상세보기
          </a>
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            출처: {detail.source.transactions}, {detail.source.reference}. 단지와 확실히 연결된 거래만 집계합니다.
          </p>
        </>
      )}
    </section>
  );
}

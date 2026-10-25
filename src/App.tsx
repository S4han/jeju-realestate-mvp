import { useCallback, useEffect, useState } from "react";
import type { ApartmentListItem, CityCode } from "./api";
import { Dashboard } from "./components/Dashboard";
import { ListSearch } from "./components/ListSearch";
import { MapView } from "./components/MapView";
import { SearchBox } from "./components/SearchBox";
import { SummaryCard } from "./components/SummaryCard";
import { TransactionsPage } from "./components/TransactionsPage";
import { describeStatus, fetchDataStatus, type DataStatusState } from "./dataStatus";
import { isRegionAnalysisAvailable } from "./phase3/api";
import { RegionAnalysis } from "./phase3/RegionAnalysis";

const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_JS_KEY as string | undefined;

type View = "dashboard" | "map" | "list";
const VIEW_LABEL: Record<View, string> = { dashboard: "대시보드", map: "지도", list: "목록" };
const VIEW_HASH: Record<View, string> = { dashboard: "#/", map: "#/map", list: "#/list" };

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const [status, setStatus] = useState<DataStatusState>({ kind: "loading" });
  const [city, setCity] = useState<CityCode | "">("");
  const [mapFailed, setMapFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  // Phase 3 (P3-D3): region analysis is reachable only when its status API answers 200 (feature flag on).
  const [regionsOn, setRegionsOn] = useState(false);
  const hash = useHash();
  const detailId = /^#\/apartments\/(\d+)$/.exec(hash)?.[1];
  // Views live in the URL hash so each one can be linked: #/ dashboard (first screen), #/map, #/list.
  const view: View = hash === "#/map" ? "map" : hash === "#/list" ? "list" : "dashboard";
  const mode = view === "map" && mapFailed ? "list" : view;

  useEffect(() => {
    void fetchDataStatus().then(setStatus);
    void isRegionAnalysisAvailable().then(setRegionsOn);
  }, []);

  const onUnavailable = useCallback(() => setMapFailed(true), []);
  const onSelectId = useCallback((id: string) => setSelected(id), []);
  const onPick = useCallback((item: ApartmentListItem) => {
    setSelected(item.id);
    if (item.lat !== null && item.lng !== null) setFocus({ lat: item.lat, lng: item.lng, seq: Date.now() });
  }, []);

  // key: filters and pages reset when moving to another apartment.
  if (detailId) return <TransactionsPage key={detailId} id={detailId} />;
  if (regionsOn && hash === "#/regions") return <RegionAnalysis appKey={KAKAO_KEY} />;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="z-20 border-b border-slate-200 bg-white px-4 pb-3 pt-2">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <h1 className="shrink-0 text-base font-semibold">제주 아파트 실거래</h1>
          <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">개발 중</span>
          <div className="ml-auto flex shrink-0 gap-1 text-xs" role="group" aria-label="보기 방식">
            {(Object.keys(VIEW_LABEL) as View[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m === "map" && mapFailed}
                aria-pressed={mode === m}
                onClick={() => (window.location.hash = VIEW_HASH[m])}
                className={`whitespace-nowrap rounded-md border px-2 py-1 ${mode === m ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white"} disabled:opacity-40`}
              >
                {VIEW_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className={`mx-auto mt-2 flex max-w-2xl gap-2 ${mode === "dashboard" ? "hidden" : ""}`}>
          <select
            aria-label="지역 선택"
            value={city}
            onChange={(e) => setCity(e.target.value as CityCode | "")}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="">제주 전체</option>
            <option value="50110">제주시</option>
            <option value="50130">서귀포시</option>
          </select>
          <div className="min-w-0 flex-1">{mode === "map" && <SearchBox city={city} onSelect={onPick} />}</div>
        </div>
        <p className={`mx-auto mt-2 max-w-2xl text-xs ${status.kind === "error" ? "text-red-700" : "text-slate-500"}`} aria-live="polite">
          {describeStatus(status)}
        </p>
      </header>
      {mapFailed && (
        <div role="alert" className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          지도를 불러올 수 없어 목록 검색으로 전환했습니다.
        </div>
      )}
      <main className="relative min-h-0 flex-1">
        {mode === "dashboard" ? (
          <div className="h-full overflow-auto">
            {regionsOn && (
              <div className="px-4 pt-3">
                <a href="#/regions" className="mx-auto flex max-w-2xl items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
                  <span>읍면동별 시세·거래량 지도</span>
                  <span aria-hidden="true">지역 분석 →</span>
                </a>
              </div>
            )}
            <Dashboard />
          </div>
        ) : mode === "map" ? (
          <MapView appKey={KAKAO_KEY} city={city} focus={focus} onSelect={onSelectId} onUnavailable={onUnavailable} />
        ) : (
          <div className="mx-auto h-full max-w-2xl overflow-auto pb-64">
            <ListSearch city={city} onSelect={onPick} />
          </div>
        )}
      </main>
      {selected && <SummaryCard id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

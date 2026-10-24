import { useCallback, useEffect, useState } from "react";
import type { ApartmentListItem, CityCode } from "./api";
import { ListSearch } from "./components/ListSearch";
import { MapView } from "./components/MapView";
import { SearchBox } from "./components/SearchBox";
import { SummaryCard } from "./components/SummaryCard";
import { describeStatus, fetchDataStatus, type DataStatusState } from "./dataStatus";

const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_JS_KEY as string | undefined;

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
  const [mode, setMode] = useState<"map" | "list">("map");
  const [mapFailed, setMapFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  const hash = useHash();
  const detailId = /^#\/apartments\/(\d+)$/.exec(hash)?.[1];

  useEffect(() => {
    void fetchDataStatus().then(setStatus);
  }, []);

  const onUnavailable = useCallback(() => {
    setMapFailed(true);
    setMode("list");
  }, []);
  const onSelectId = useCallback((id: string) => setSelected(id), []);
  const onPick = useCallback((item: ApartmentListItem) => {
    setSelected(item.id);
    if (item.lat !== null && item.lng !== null) setFocus({ lat: item.lat, lng: item.lng, seq: Date.now() });
  }, []);

  if (detailId) {
    return (
      <div className="min-h-dvh bg-slate-50 p-4 text-slate-900">
        <a href="#/" className="text-sm text-sky-700">← 지도로 돌아가기</a>
        <p className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">거래 상세 화면은 다음 단계(TASK-007)에서 제공됩니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="z-20 border-b border-slate-200 bg-white px-4 pb-3 pt-2">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <h1 className="shrink-0 text-base font-semibold">제주 아파트 실거래</h1>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">개발 중</span>
          <div className="ml-auto flex gap-1 text-xs" role="group" aria-label="보기 방식">
            {(["map", "list"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m === "map" && mapFailed}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-md border px-2 py-1 ${mode === m ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white"} disabled:opacity-40`}
              >
                {m === "map" ? "지도" : "목록"}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-2 flex max-w-2xl gap-2">
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
        {mode === "map" ? (
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

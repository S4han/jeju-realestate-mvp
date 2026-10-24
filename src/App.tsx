import { useEffect, useState } from "react";
import { describeStatus, fetchDataStatus, type DataStatusState } from "./dataStatus";

export default function App() {
  const [status, setStatus] = useState<DataStatusState>({ kind: "loading" });

  useEffect(() => {
    void fetchDataStatus().then(setStatus);
  }, []);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <h1 className="shrink-0 text-base font-semibold">제주 아파트 실거래</h1>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">개발 중</span>
        </div>
        <div className="mx-auto mt-2 max-w-2xl">
          <input
            type="search"
            disabled
            placeholder="아파트명 검색 (TASK-006에서 제공)"
            className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm"
          />
        </div>
      </header>
      <main className="mx-auto max-w-2xl p-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm" aria-live="polite">
          <h2 className="mb-1 font-medium">데이터 상태</h2>
          <p className={status.kind === "error" ? "text-red-700" : "text-slate-700"}>{describeStatus(status)}</p>
        </section>
      </main>
    </div>
  );
}

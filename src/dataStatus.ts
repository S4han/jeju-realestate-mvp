export type DataStatus = {
  status: "OK" | "DELAYED" | "NO_DATA";
  sources: { source_id: string; city_code: string | null; last_success_at: string | null; delayed: boolean }[];
  generated_at: string;
};

export type DataStatusState =
  | { kind: "loading" }
  | { kind: "ready"; data: DataStatus }
  | { kind: "error" };

export async function fetchDataStatus(fetchImpl: typeof fetch = fetch): Promise<DataStatusState> {
  try {
    const res = await fetchImpl("/api/system/data-status");
    if (!res.ok) return { kind: "error" };
    return { kind: "ready", data: (await res.json()) as DataStatus };
  } catch {
    return { kind: "error" };
  }
}

// User-facing message; "no data yet" and "outage" are deliberately distinct (PRD 수용 원칙).
export function describeStatus(state: DataStatusState): string {
  switch (state.kind) {
    case "loading":
      return "데이터 상태 확인 중…";
    case "error":
      return "데이터 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    case "ready": {
      const { data } = state;
      if (data.status === "NO_DATA") return "아직 수집된 데이터가 없습니다.";
      const latest = data.sources.map((s) => s.last_success_at).filter((v): v is string => !!v).sort().at(-1);
      const when = latest ? new Date(latest).toLocaleString("ko-KR") : "알 수 없음";
      return data.status === "DELAYED"
        ? `일부 데이터 갱신이 지연되고 있습니다. 마지막 정상 갱신: ${when}`
        : `최신 데이터 기준: ${when}`;
    }
  }
}

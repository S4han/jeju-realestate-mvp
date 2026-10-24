import { describe, expect, it } from "vitest";
import { describeStatus, fetchDataStatus } from "../src/dataStatus";

describe("data status client", () => {
  it("distinguishes no-data from outage", () => {
    const noData = describeStatus({ kind: "ready", data: { status: "NO_DATA", sources: [], generated_at: "" } });
    const outage = describeStatus({ kind: "error" });
    expect(noData).toContain("아직 수집된 데이터가 없습니다");
    expect(outage).toContain("연결할 수 없습니다");
    expect(noData).not.toBe(outage);
  });

  it("shows the last successful update when delayed", () => {
    const msg = describeStatus({
      kind: "ready",
      data: {
        status: "DELAYED",
        sources: [{ source_id: "MOLIT_SALE", city_code: "50110", last_success_at: "2026-10-01T00:00:00Z", delayed: true }],
        generated_at: "",
      },
    });
    expect(msg).toContain("지연");
    expect(msg).toContain("2026");
  });

  it("maps HTTP errors and network failures to the error state", async () => {
    const http503 = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    const broken = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    expect(await fetchDataStatus(http503)).toEqual({ kind: "error" });
    expect(await fetchDataStatus(broken)).toEqual({ kind: "error" });
  });
});

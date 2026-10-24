import { describe, expect, it } from "vitest";
import { fetchMonth, parseMolitXml, SourceError, type Fetcher } from "../server/collect/molit";
import { recentMonths } from "../server/collect/months";
import { normalizeItem, parseManwon, parseShortDate, type NormalizedTx } from "../server/collect/normalize";
import { reconcileGroup, type ExistingTx } from "../server/collect/reconcile";
import { gatewayErrorXml, rentItem, responseXml, saleItem } from "./helpers/molitFixture";

describe("parseMolitXml", () => {
  it("reads items as strings, trimming blank tags", () => {
    const { items, totalCount } = parseMolitXml(responseXml([saleItem({ bonbun: "0024" })], 1));
    expect(totalCount).toBe(1);
    expect(items[0]!.bonbun).toBe("0024"); // leading zeros preserved
    expect(items[0]!.cdealType).toBe("");
  });

  it("handles empty months and error envelopes", () => {
    expect(parseMolitXml(responseXml([], 0)).items).toEqual([]);
    expect(() => parseMolitXml(responseXml([], 0, 1, 10, "03"))).toThrow(expect.objectContaining({ code: "RESULT_03" }));
    expect(() => parseMolitXml(gatewayErrorXml("30"))).toThrow(expect.objectContaining({ code: "GATEWAY_30" }));
    expect(() => parseMolitXml("<html>502</html>")).toThrow(SourceError);
  });
});

describe("fetchMonth", () => {
  const key = "TESTKEY+/abc==";
  const pages = (all: ReturnType<typeof rentItem>[], size: number): Fetcher => async (url) => {
    const page = Number(new URL(url).searchParams.get("pageNo"));
    return { status: 200, text: responseXml(all.slice((page - 1) * size, page * size), all.length, page, size) };
  };

  it("pages rent at 400 rows and URL-encodes the key", async () => {
    const all = Array.from({ length: 450 }, (_, i) => rentItem({ floor: String(i) }));
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(url);
      return pages(all, 400)(url);
    };
    let reserved = 0;
    const r = await fetchMonth({ source: "MOLIT_RENT", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher, beforeCall: async () => void reserved++ });
    expect(r).toMatchObject({ totalCount: 450, calls: 2 });
    expect(r.items).toHaveLength(450);
    expect(reserved).toBe(2);
    expect(seen[0]).toContain("numOfRows=400");
    expect(seen[0]).toContain(`serviceKey=${encodeURIComponent(key)}`);
  });

  it("retries network failures, counting every attempt against the budget", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return { status: 200, text: responseXml([saleItem()]) };
    };
    let reserved = 0;
    const r = await fetchMonth({ source: "MOLIT_SALE", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher, beforeCall: async () => void reserved++, retryDelaysMs: [0, 0] });
    expect(r.calls).toBe(2);
    expect(reserved).toBe(2);
  });

  it("gives up after retries with a NETWORK error that never contains the URL or key", async () => {
    const fetcher: Fetcher = async (url) => {
      throw new TypeError(`failed ${url}`);
    };
    const err = await fetchMonth({ source: "MOLIT_SALE", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher, beforeCall: async () => {}, retryDelaysMs: [0, 0] }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("NETWORK");
    expect(err.message).not.toContain("TESTKEY");
  });

  it("does not retry result-code errors and stops when the budget refuses", async () => {
    let calls = 0;
    const bad: Fetcher = async () => (calls++, { status: 200, text: responseXml([], 0, 1, 10, "10") });
    await expect(fetchMonth({ source: "MOLIT_SALE", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher: bad, beforeCall: async () => {} })).rejects.toMatchObject({ code: "RESULT_10" });
    expect(calls).toBe(1);
    const never: Fetcher = async () => {
      throw new Error("must not be called");
    };
    await expect(fetchMonth({ source: "MOLIT_SALE", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher: never, beforeCall: async () => { throw new Error("budget"); } })).rejects.toThrow("budget");
  });

  it("rejects a short read", async () => {
    const short: Fetcher = async () => ({ status: 200, text: responseXml([saleItem()], 5) });
    await expect(fetchMonth({ source: "MOLIT_SALE", lawdCd: "50110", dealYmd: "202608", serviceKey: key, fetcher: short, beforeCall: async () => {} })).rejects.toMatchObject({ code: "COUNT_MISMATCH" });
  });
});

describe("normalize", () => {
  const expectCtx = { sggCode: "50110", dealYmd: "202608" };

  it("parses amounts and short dates", () => {
    expect(parseManwon("40,300")).toBe(403_000_000);
    expect(parseManwon("0")).toBe(0);
    expect(parseManwon("4,03")).toBeNull();
    expect(parseShortDate("26.09.28")).toBe("2026-09-28");
    expect(parseShortDate(" ")).toBeNull();
    expect(parseShortDate("26.02.30")).toBeUndefined();
  });

  it("normalizes a sale with PNU and a cancelled sale", () => {
    const ok = normalizeItem("MOLIT_SALE", saleItem(), expectCtx);
    expect(ok).toMatchObject({ ok: true, tx: { salePrice: 403_000_000, contractDate: "2026-08-18", floor: 3, pnu: "5011012500113940001", recordStatus: "ACTIVE", aptDong: null } });
    const c = normalizeItem("MOLIT_SALE", saleItem({ cdealType: "O", cdealDay: "26.09.28" }), expectCtx);
    expect(c).toMatchObject({ ok: true, tx: { recordStatus: "CANCELLED", cancelledOn: "2026-09-28" } });
    // Cancellation does not change the natural key.
    if (ok.ok && c.ok) expect(c.tx.naturalKey).toBe(ok.tx.naturalKey);
  });

  it("normalizes rent with deposit and monthly rent kept separate", () => {
    const r = normalizeItem("MOLIT_RENT", rentItem(), expectCtx);
    expect(r).toMatchObject({ ok: true, tx: { deposit: 110_380_000, monthlyRent: 510_000, salePrice: null, contractType: "신규" } });
    const jeonse = normalizeItem("MOLIT_RENT", rentItem({ monthlyRent: "0" }), expectCtx);
    expect(jeonse).toMatchObject({ ok: true, tx: { monthlyRent: 0 } });
  });

  it("rejects rows it cannot read safely", () => {
    expect(normalizeItem("MOLIT_SALE", saleItem({ dealMonth: "7" }), expectCtx)).toEqual({ ok: false, reason: "MONTH_MISMATCH" });
    expect(normalizeItem("MOLIT_SALE", saleItem({ sggCd: "50130" }), expectCtx)).toEqual({ ok: false, reason: "SGG_MISMATCH" });
    expect(normalizeItem("MOLIT_SALE", saleItem({ dealAmount: "" }), expectCtx)).toEqual({ ok: false, reason: "BAD_AMOUNT" });
    expect(normalizeItem("MOLIT_SALE", saleItem({ cdealType: "O", cdealDay: " " }), expectCtx)).toEqual({ ok: false, reason: "CANCEL_WITHOUT_DATE" });
    expect(normalizeItem("MOLIT_SALE", saleItem({ floor: "3층" }), expectCtx)).toEqual({ ok: false, reason: "BAD_FLOOR" });
    expect(normalizeItem("MOLIT_SALE", saleItem({ floor: "-1" }), expectCtx)).toMatchObject({ ok: true, tx: { floor: -1 } });
  });
});

describe("reconcileGroup", () => {
  const tx = (over: Partial<NormalizedTx> = {}): NormalizedTx => {
    const n = normalizeItem("MOLIT_SALE", saleItem(), { sggCode: "50110", dealYmd: "202608" });
    if (!n.ok) throw new Error("fixture");
    return { ...n.tx, ...over };
  };
  const ex = (id: string, occurrence: number, over: Partial<ExistingTx> = {}): ExistingTx => ({
    id, occurrence, recordStatus: "ACTIVE", cancelledOn: null, registeredOn: null, aptDong: null, ...over,
  });

  it("keeps the same id when a deal becomes cancelled", () => {
    const plan = reconcileGroup([ex("10", 1)], [tx({ recordStatus: "CANCELLED", cancelledOn: "2026-09-28" })], true);
    expect(plan).toEqual({ update: [{ id: "10", tx: expect.objectContaining({ recordStatus: "CANCELLED" }) }], insert: [], missing: [] });
  });

  it("pairs a cancelled original and its re-report without swapping ids", () => {
    const existing = [ex("10", 1), ex("11", 2, { aptDong: "107" })];
    const incoming = [tx({ aptDong: "107", registeredOn: "2026-10-01" }), tx({ recordStatus: "CANCELLED", cancelledOn: "2026-08-20" })];
    const plan = reconcileGroup(existing, incoming, true);
    const byId = Object.fromEntries(plan.update.map((u) => [u.id, u.tx]));
    expect(byId["10"]!.recordStatus).toBe("CANCELLED");
    expect(byId["11"]!.aptDong).toBe("107");
    expect(plan.insert).toEqual([]);
  });

  it("adds identical rows as new occurrences and marks vanished rows missing", () => {
    expect(reconcileGroup([ex("10", 1)], [tx(), tx()], true).insert.map((i) => i.occurrence)).toEqual([2]);
    expect(reconcileGroup([ex("10", 1), ex("11", 2)], [tx()], true).missing).toEqual(["11"]);
    expect(reconcileGroup([ex("10", 1), ex("11", 2)], [tx()], false).missing).toEqual([]);
  });

  it("revives a row that came back after being missing", () => {
    const plan = reconcileGroup([ex("10", 1, { recordStatus: "MISSING_FROM_SOURCE" })], [tx()], true);
    expect(plan.update).toEqual([{ id: "10", tx: expect.objectContaining({ recordStatus: "ACTIVE" }) }]);
  });
});

describe("recentMonths", () => {
  it("counts in KST and includes the current month", () => {
    // 2026-10-31T16:00Z is already November 1st in Korea.
    expect(recentMonths(3, new Date("2026-10-31T16:00:00Z"))).toEqual(["202609", "202610", "202611"]);
    expect(recentMonths(12, new Date("2026-10-24T03:00:00Z"))).toHaveLength(12);
    expect(recentMonths(12, new Date("2026-10-24T03:00:00Z"))[0]).toBe("202511");
  });
});

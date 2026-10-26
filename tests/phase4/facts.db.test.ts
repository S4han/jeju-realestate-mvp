// P4-TASK-002: fact sheet for the AI region summary on the Phase 3 fictional region set and fictional deals.
// A 일도일동: 5 apartments, each +0~40% on itself (same-complex median +20%), plus a new pricey apartment that
//            trades only recently → the region median jumps (+73.3%): a composition effect.
// C 한림읍:  3 → 4 deals, +100% (small sample).  D 서귀동 (서귀포시): 10 → 10 deals, −10%.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { periodWindow } from "../../server/phase2/analysis";
import { activateRegionSet, buildRegionSet, parseCodeCsv, saveRegionSet } from "../../server/phase3/regionSet";
import { loadFacts, type Fact, type FactResult } from "../../server/phase4/facts";
import { CODES, META, files } from "../phase3/fixture";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T03:00:00Z");
const A = "5011010100", C = "5011025000", D = "5013010100";
const M = 1_000_000;

describe.skipIf(!url)("AI summary facts (DB)", () => {
  let pool: pg.Pool;
  let seq = 0;
  const apt = async (legal: string) =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ('단지',$1,$2,'x','NONE') RETURNING apartment_id",
      [legal.slice(0, 5), legal],
    )).rows[0].apartment_id);
  const sale = (aptId: string | null, date: string, perM2: number, sgg = "50110") =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price, record_status)
       VALUES ('sale',$1,1,$2,$3,'동','단지',$4,100,$5,'ACTIVE')`,
      [`f-${++seq}`, aptId, sgg, date, perM2 * 100],
    );
  const facts = async (scope: "JEJU" | "50110" | "50130", now = NOW) => {
    const r = await loadFacts(pool, scope, now);
    if (!r.ok) throw new Error(`no facts: ${r.reason}`);
    return r.sheet;
  };
  const get = (fs: Fact[], id: string) => fs.find((f) => f.id === id);
  const show = (f: Fact | undefined) => f && Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, v.display]));

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    const setId = (await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20))).setId;
    await activateRegionSet(pool, setId);
    await pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
       SELECT 'MOLIT_SALE', c, p, 'SUCCESS', $1, $1 FROM unnest($2::text[]) p CROSS JOIN unnest(ARRAY['50110','50130']) c`,
      [new Date(NOW.getTime() - 3_600_000), periodWindow(36, NOW).months],
    );
    const prev = ["2025-01-10", "2025-03-10", "2025-05-10"];
    const recent = ["2025-12-10", "2026-02-10", "2026-04-10"];
    for (let i = 0; i < 5; i++) {
      const id = await apt("5011010100");
      for (const d of prev) await sale(id, d, (i + 1) * M);
      for (const d of recent) await sale(id, d, Math.round((i + 1) * (1 + i / 10) * M));
    }
    const fresh = await apt("5011010100");
    for (let k = 0; k < 6; k++) await sale(fresh, "2026-06-10", 10 * M);
    const c = await apt("5011025021");
    for (const d of prev) await sale(c, d, M);
    for (const d of [...recent, "2026-05-10"]) await sale(c, d, 2 * M);
    const d = await apt("5013010100");
    for (let k = 0; k < 10; k++) await sale(d, `2025-0${(k % 9) + 1}-15`, 2 * M, "50130");
    for (let k = 0; k < 10; k++) await sale(d, `2026-0${(k % 9) + 1}-15`, 1.8 * M, "50130");
    await sale(null, "2026-03-03", 3 * M); // unmatched → isolated at city level
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("ranks movers only with >= 10 deals on both sides and keeps small samples apart", async () => {
    const s = await facts("JEJU");
    expect(get(s.facts, "UP1")).toMatchObject({ region: { code: A, name: "일도일동" } });
    expect(show(get(s.facts, "UP1"))).toEqual({ change: "+73.3%", recent: "520만원/㎡", previous: "300만원/㎡", recentCount: "21건", previousCount: "15건" });
    expect(show(get(s.facts, "DOWN1"))).toMatchObject({ change: "-10.0%", recentCount: "10건" });
    expect(get(s.facts, "DOWN1")!.region.code).toBe(D);
    expect(get(s.facts, "SMALL1")).toMatchObject({ region: { code: C } });
    expect(show(get(s.facts, "SMALL1"))).toMatchObject({ change: "+100.0%", recentCount: "4건", previousCount: "3건" });
    expect(s.facts.filter((f) => f.kind === "TOP_UP" || f.kind === "TOP_DOWN").map((f) => f.region.code)).not.toContain(C);
  });

  it("separates the composition effect with the same-apartment comparison", async () => {
    const s = await facts("JEJU");
    expect(show(get(s.facts, `SAME.${A}`))).toEqual({ change: "+20.0%", apartments: "5곳" });
    // 제주시: A's 5 apartments (×1.0~1.4) + 한림 (×2.0) → median of 6 ratios = 1.25
    expect(show(get(s.facts, "SAME.5011000000"))).toEqual({ change: "+25.0%", apartments: "6곳" });
    expect(get(s.facts, `SAME.${D}`)).toBeUndefined(); // one apartment < 5
    expect(s.notes.some((n) => n.includes("같은 단지 기준"))).toBe(true);
  });

  it("reports city counts, volume leaders, volume shifts and isolated deals", async () => {
    const s = await facts("JEJU");
    expect(show(get(s.facts, "C50110.count"))).toEqual({ recent: "25건", previous: "18건", change: "+38.9%" });
    expect(show(get(s.facts, "C50130.count"))).toEqual({ recent: "10건", previous: "10건", change: "0.0%" });
    expect(s.facts.filter((f) => f.kind === "TOP_VOLUME").map((f) => [f.region.code, f.fields.recentCount!.display])).toEqual([[A, "21건"], [D, "10건"], [C, "4건"]]);
    expect(show(get(s.facts, "SHIFT1"))).toMatchObject({ change: "+40.0%" });
    expect(show(get(s.facts, "C50110.unmapped"))).toEqual({ count: "1건", total: "26건" });
    expect(s.notes).toEqual(expect.arrayContaining([expect.stringContaining("2025.11~"), expect.stringContaining("신고 기한"), expect.stringContaining("거래가 적은 지역")]));
  });

  it("limits a city scope to its own regions and shares the 12/24-month snapshot id", async () => {
    const j = await facts("JEJU");
    const s = await facts("50130");
    expect(new Set(s.facts.map((f) => f.region.code.slice(0, 5)))).toEqual(new Set(["50130"]));
    expect(s.snapshotId).toBe(j.snapshotId);
  });

  it("is deterministic for the same data", async () => {
    expect(await facts("JEJU")).toEqual(await facts("JEJU"));
  });

  it("writes no facts when a month is missing or the data is stale", async () => {
    const r: FactResult = await loadFacts(pool, "JEJU", new Date(NOW.getTime() + 49 * 3_600_000));
    expect(r).toMatchObject({ ok: false, reason: "STALE_DATA" });
    await pool.query("INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE','50130','202609','FAILED',$1,$1)", [new Date(NOW.getTime() - 1_800_000)]);
    try {
      expect(await loadFacts(pool, "JEJU", NOW)).toMatchObject({ ok: false, reason: "INCOMPLETE_DATA" });
      expect(await loadFacts(pool, "50130", NOW)).toMatchObject({ ok: false, reason: "INCOMPLETE_DATA" });
      expect((await loadFacts(pool, "50110", NOW)).ok).toBe(true); // the other city is unaffected (as TC-020)
    } finally {
      await pool.query("INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE','50130','202609','SUCCESS',$1,$1)", [new Date(NOW.getTime() - 900_000)]);
    }
  });
});

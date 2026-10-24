import type pg from "pg";
import type { NormalizedTx } from "./normalize.js";
import { reconcileGroup, type ExistingTx } from "./reconcile.js";

export type ApplySummary = { inserted: number; updated: number; cancelled: number; missing: number };

const monthRange = (ymd: string) => {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4));
  const start = `${ymd.slice(0, 4)}-${ymd.slice(4)}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
};

// Replaces one (type, region, month) snapshot. Must run inside the caller's transaction.
export async function applyMonth(
  client: pg.PoolClient,
  tradeType: "sale" | "rent",
  sggCode: string,
  ymd: string,
  txs: NormalizedTx[],
  allowMissing: boolean,
): Promise<ApplySummary> {
  const { start, end } = monthRange(ymd);
  const { rows } = await client.query<{
    transaction_id: string; natural_key: string; occurrence: number; record_status: ExistingTx["recordStatus"];
    cancelled_on: string | null; registered_on: string | null; apt_dong: string | null;
  }>(
    `SELECT transaction_id, natural_key, occurrence, record_status, to_char(cancelled_on,'YYYY-MM-DD') AS cancelled_on,
            to_char(registered_on,'YYYY-MM-DD') AS registered_on, apt_dong
       FROM transactions WHERE trade_type = $1 AND sgg_code = $2 AND contract_date >= $3 AND contract_date < $4
       FOR UPDATE`,
    [tradeType, sggCode, start, end],
  );
  const existing = new Map<string, ExistingTx[]>();
  for (const r of rows) {
    const list = existing.get(r.natural_key) ?? [];
    list.push({ id: r.transaction_id, occurrence: r.occurrence, recordStatus: r.record_status, cancelledOn: r.cancelled_on, registeredOn: r.registered_on, aptDong: r.apt_dong });
    existing.set(r.natural_key, list);
  }
  const incoming = new Map<string, NormalizedTx[]>();
  for (const t of txs) incoming.set(t.naturalKey, [...(incoming.get(t.naturalKey) ?? []), t]);

  const summary: ApplySummary = { inserted: 0, updated: 0, cancelled: 0, missing: 0 };
  for (const key of new Set([...existing.keys(), ...incoming.keys()])) {
    const before = existing.get(key) ?? [];
    const plan = reconcileGroup(before, incoming.get(key) ?? [], allowMissing);
    for (const { id, tx } of plan.update) {
      const prev = before.find((e) => e.id === id)!;
      if (prev.recordStatus !== "CANCELLED" && tx.recordStatus === "CANCELLED") summary.cancelled++;
      await client.query(
        `UPDATE transactions SET record_status=$1, cancelled_on=$2, registered_on=$3, apt_dong=$4, source_apt_seq=$5,
           umd_code=$6, source_pnu=$7, last_seen_at=now(), source_updated_at=now() WHERE transaction_id=$8`,
        [tx.recordStatus, tx.cancelledOn, tx.registeredOn, tx.aptDong, tx.sourceAptSeq, tx.umdCode, tx.pnu, id],
      );
      summary.updated++;
    }
    for (const { occurrence, tx } of plan.insert) {
      await client.query(
        `INSERT INTO transactions (trade_type, natural_key, occurrence, source_apt_seq, source_pnu, sgg_code, umd_code, umd_name,
           jibun, apt_name_raw, apt_dong, contract_date, area_m2, floor, sale_price, deposit, monthly_rent, contract_type,
           contract_term, cancelled_on, registered_on, record_status, source_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())`,
        [tx.tradeType, tx.naturalKey, occurrence, tx.sourceAptSeq, tx.pnu, tx.sggCode, tx.umdCode, tx.umdName, tx.jibun,
         tx.aptNameRaw, tx.aptDong, tx.contractDate, tx.areaM2, tx.floor, tx.salePrice, tx.deposit, tx.monthlyRent,
         tx.contractType, tx.contractTerm, tx.cancelledOn, tx.registeredOn, tx.recordStatus],
      );
      summary.inserted++;
      if (tx.recordStatus === "CANCELLED") summary.cancelled++;
    }
    if (plan.missing.length) {
      await client.query(
        "UPDATE transactions SET record_status='MISSING_FROM_SOURCE', source_updated_at=now() WHERE transaction_id = ANY($1::bigint[])",
        [plan.missing],
      );
      summary.missing += plan.missing.length;
    }
  }
  return summary;
}

import type pg from "pg";
import { matchAll, type ApartmentLite, type TxLite } from "./engine.js";

export type MatchSummary = {
  transactions: number;
  confirmed: number;
  pending: Record<string, number>;
  seqs: { confirmed: number; pending: Record<string, number> };
};

// Recomputes all automatic match decisions in one transaction. Only CONFIRMED rows get apartment_id;
// match_reviews keeps one current decision per transaction with its reason and evidence.
export async function runMatching(pool: pg.Pool): Promise<MatchSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txRows = await client.query<{ transaction_id: string; trade_type: "sale" | "rent"; source_apt_seq: string | null; source_pnu: string | null; sgg_code: string; umd_name: string; jibun: string | null; apt_name_raw: string }>(
      "SELECT transaction_id, trade_type, source_apt_seq, source_pnu, sgg_code, umd_name, jibun, apt_name_raw FROM transactions",
    );
    const aptRows = await client.query<{ apartment_id: string; pnu: string | null; lot_address: string | null; names: string[] }>(
      `SELECT a.apartment_id, a.pnu, a.lot_address,
              array_remove(array_agg(DISTINCT al.alias_name) || a.name, NULL) AS names
         FROM apartments a LEFT JOIN apartment_aliases al USING (apartment_id)
        GROUP BY a.apartment_id`,
    );
    const txs: TxLite[] = txRows.rows.map((r) => ({
      id: r.transaction_id, tradeType: r.trade_type, aptSeq: r.source_apt_seq, pnu: r.source_pnu?.trim() || null,
      sggCode: r.sgg_code, umdName: r.umd_name, jibun: r.jibun, aptName: r.apt_name_raw,
    }));
    const apartments: ApartmentLite[] = aptRows.rows.map((r) => ({ id: r.apartment_id, pnu: r.pnu?.trim() || null, lotAddress: r.lot_address, names: r.names }));
    const result = matchAll(txs, apartments);

    // aptSeq → apartment mapping for confirmed complexes.
    await client.query("DELETE FROM apartment_source_ids WHERE source = 'MOLIT_APTSEQ'");
    const confirmedSeqs = [...result.seqs].filter(([, d]) => d.status === "CONFIRMED") as [string, { apartmentId: string }][];
    await client.query(
      `INSERT INTO apartment_source_ids (source, source_id, apartment_id, verified_at)
       SELECT 'MOLIT_APTSEQ', s, a, now() FROM unnest($1::text[], $2::bigint[]) AS u(s, a)`,
      [confirmedSeqs.map(([s]) => s), confirmedSeqs.map(([, d]) => d.apartmentId)],
    );

    // Transactions: set or clear apartment_id in bulk.
    const ids = result.txs.map((d) => d.txId);
    const aptIds = result.txs.map((d) => (d.status === "CONFIRMED" ? d.apartmentId : null));
    await client.query(
      `UPDATE transactions t SET apartment_id = u.a
         FROM unnest($1::bigint[], $2::bigint[]) AS u(id, a)
        WHERE t.transaction_id = u.id AND t.apartment_id IS DISTINCT FROM u.a`,
      [ids, aptIds],
    );

    // One current review per transaction.
    await client.query("DELETE FROM match_reviews");
    await client.query(
      `INSERT INTO match_reviews (transaction_id, candidate_apartment_id, match_rule, match_status, reason, evidence)
       SELECT id, cand, rule, status, reason, jsonb_build_object('apt_seq', seq)
         FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(id, cand, rule, status, reason, seq)`,
      [
        ids,
        result.txs.map((d) => (d.status === "CONFIRMED" ? d.apartmentId : d.candidateId)),
        result.txs.map((d) => d.rule),
        result.txs.map((d) => d.status),
        result.txs.map((d) => (d.status === "PENDING" ? d.reason : null)),
        result.txs.map((d) => d.aptSeq),
      ],
    );
    await client.query(
      "INSERT INTO sync_jobs (source_id, status, record_count, started_at, completed_at) VALUES ('MATCHING', 'SUCCESS', $1, now(), now())",
      [ids.length],
    );
    await client.query("COMMIT");

    const summary: MatchSummary = { transactions: ids.length, confirmed: 0, pending: {}, seqs: { confirmed: 0, pending: {} } };
    for (const d of result.txs) {
      if (d.status === "CONFIRMED") summary.confirmed++;
      else summary.pending[d.reason] = (summary.pending[d.reason] ?? 0) + 1;
    }
    for (const d of result.seqs.values()) {
      if (d.status === "CONFIRMED") summary.seqs.confirmed++;
      else summary.seqs.pending[d.reason] = (summary.seqs.pending[d.reason] ?? 0) + 1;
    }
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

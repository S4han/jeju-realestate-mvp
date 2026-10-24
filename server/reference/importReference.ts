import type pg from "pg";
import type { ApartmentInput } from "./reb";
import { assessLocation, type Parcel } from "./location";

export type ImportOptions = { rebAsOf: string; cadastralVersion: string; now?: Date };
export type ImportSummary = {
  apartments: number;
  inserted: number;
  updated: number;
  byStatus: Record<"VERIFIED_PARCEL" | "REVIEW" | "NONE", number>;
  flags: Record<string, number>;
};

// Upserts REB apartments keyed by (REB, complex_pk) and attaches cadastral coordinates.
// Runs in one transaction so a failed import leaves the previous reference data intact.
export async function importReference(
  pool: pg.Pool,
  apartments: ApartmentInput[],
  parcels: Map<string, Parcel>,
  opts: ImportOptions,
): Promise<ImportSummary> {
  const now = opts.now ?? new Date();
  const summary: ImportSummary = { apartments: apartments.length, inserted: 0, updated: 0, byStatus: { VERIFIED_PARCEL: 0, REVIEW: 0, NONE: 0 }, flags: {} };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rebJob = await client.query<{ job_id: string }>(
      "INSERT INTO sync_jobs (source_id, status, started_at) VALUES ('REB_COMPLEX', 'RUNNING', $1) RETURNING job_id",
      [now],
    );
    for (const a of apartments) {
      const loc = assessLocation(parcels.get(a.pnu), a.unitCount);
      summary.byStatus[loc.status]++;
      for (const f of loc.flags) summary.flags[f] = (summary.flags[f] ?? 0) + 1;
      const located = loc.status !== "NONE";
      const values = [
        a.name, a.cityCode, a.legalDongCode, a.pnu, a.roadAddress, a.lotAddress, a.unitCount, a.approvedOn,
        located ? loc.lat.toFixed(7) : null,
        located ? loc.lon.toFixed(7) : null,
        loc.status,
        located ? `CADASTRAL:${opts.cadastralVersion}:${loc.method}` : null,
        loc.flags,
        located ? loc.areaM2.toFixed(1) : null,
        opts.rebAsOf,
      ];
      const existing = await client.query<{ apartment_id: string }>(
        "SELECT apartment_id FROM apartment_source_ids WHERE source = 'REB' AND source_id = $1",
        [a.rebComplexPk],
      );
      let id: string;
      if (existing.rows[0]) {
        id = existing.rows[0].apartment_id;
        await client.query(
          `UPDATE apartments SET name=$1, city_code=$2, legal_dong_code=$3, pnu=$4, road_address=$5, lot_address=$6,
             unit_count=$7, approved_on=$8, latitude=$9, longitude=$10, location_status=$11, location_source=$12,
             location_flags=$13, parcel_area_m2=$14, source_updated_at=$15, updated_at=now()
           WHERE apartment_id=$16`,
          [...values, id],
        );
        summary.updated++;
      } else {
        const ins = await client.query<{ apartment_id: string }>(
          `INSERT INTO apartments (name, city_code, legal_dong_code, pnu, road_address, lot_address, unit_count, approved_on,
             latitude, longitude, location_status, location_source, location_flags, parcel_area_m2, source_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING apartment_id`,
          values,
        );
        id = ins.rows[0]!.apartment_id;
        await client.query(
          "INSERT INTO apartment_source_ids (source, source_id, apartment_id, verified_at) VALUES ('REB', $1, $2, $3)",
          [a.rebComplexPk, id, now],
        );
        summary.inserted++;
      }
      await client.query("DELETE FROM apartment_aliases WHERE apartment_id = $1 AND source LIKE 'REB_%'", [id]);
      for (const alias of a.aliases) {
        await client.query(
          "INSERT INTO apartment_aliases (apartment_id, alias_name, source, verified_at) VALUES ($1, $2, $3, $4)",
          [id, alias.name, alias.source, now],
        );
      }
    }
    await client.query(
      "UPDATE sync_jobs SET status='SUCCESS', record_count=$1, completed_at=$2 WHERE job_id=$3",
      [apartments.length, now, rebJob.rows[0]!.job_id],
    );
    await client.query(
      "INSERT INTO sync_jobs (source_id, status, record_count, started_at, completed_at) VALUES ('CADASTRAL', 'SUCCESS', $1, $2, $2)",
      [summary.byStatus.VERIFIED_PARCEL + summary.byStatus.REVIEW, now],
    );
    await client.query("COMMIT");
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

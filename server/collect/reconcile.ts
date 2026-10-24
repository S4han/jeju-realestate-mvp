import type { NormalizedTx } from "./normalize.js";

export type ExistingTx = {
  id: string;
  occurrence: number;
  recordStatus: "ACTIVE" | "CANCELLED" | "MISSING_FROM_SOURCE";
  cancelledOn: string | null;
  registeredOn: string | null;
  aptDong: string | null;
};

export type GroupPlan = {
  update: { id: string; tx: NormalizedTx }[];
  insert: { occurrence: number; tx: NormalizedTx }[];
  missing: string[];
};

// Matches stored rows to freshly fetched rows that share a natural key, so transaction ids stay
// stable when a deal is later cancelled or registered. Preference: exact attributes, then same status
// and dong, same status and cancel date, same dong, same status, then any remaining row (ACTIVE → CANCELLED).
export function reconcileGroup(existing: ExistingTx[], incoming: NormalizedTx[], allowMissing: boolean): GroupPlan {
  const ex = [...existing].sort((a, b) => a.occurrence - b.occurrence);
  const inc = [...incoming].sort((a, b) =>
    `${a.recordStatus}|${a.cancelledOn ?? ""}|${a.registeredOn ?? ""}|${a.aptDong ?? ""}`.localeCompare(
      `${b.recordStatus}|${b.cancelledOn ?? ""}|${b.registeredOn ?? ""}|${b.aptDong ?? ""}`,
    ),
  );
  const usedEx = new Set<number>();
  const usedIn = new Set<number>();
  const plan: GroupPlan = { update: [], insert: [], missing: [] };
  const passes: ((e: ExistingTx, t: NormalizedTx) => boolean)[] = [
    (e, t) => e.recordStatus === t.recordStatus && e.cancelledOn === t.cancelledOn && e.registeredOn === t.registeredOn && e.aptDong === t.aptDong,
    (e, t) => e.recordStatus === t.recordStatus && e.aptDong === t.aptDong,
    (e, t) => e.recordStatus === t.recordStatus && e.cancelledOn === t.cancelledOn,
    (e, t) => e.aptDong === t.aptDong,
    (e, t) => e.recordStatus === t.recordStatus,
    () => true,
  ];
  for (const same of passes) {
    inc.forEach((t, i) => {
      if (usedIn.has(i)) return;
      const j = ex.findIndex((e, k) => !usedEx.has(k) && same(e, t));
      if (j === -1) return;
      usedEx.add(j);
      usedIn.add(i);
      plan.update.push({ id: ex[j]!.id, tx: t });
    });
  }
  let next = ex.reduce((m, e) => Math.max(m, e.occurrence), 0);
  inc.forEach((t, i) => {
    if (!usedIn.has(i)) plan.insert.push({ occurrence: ++next, tx: t });
  });
  if (allowMissing) {
    ex.forEach((e, k) => {
      if (!usedEx.has(k) && e.recordStatus !== "MISSING_FROM_SOURCE") plan.missing.push(e.id);
    });
  }
  return plan;
}

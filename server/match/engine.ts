// Strict apartment ↔ transaction matching (TASK-005, PRD FR-012/FR-013).
// A transaction is linked only when its source complex (aptSeq) resolves to exactly one reference
// apartment by parcel (PNU) or exact lot address AND the names agree after normalization.
// Everything else stays unlinked with a recorded reason. Names alone never link anything.

export type TxLite = {
  id: string;
  tradeType: "sale" | "rent";
  aptSeq: string | null;
  pnu: string | null; // sale only
  sggCode: string;
  umdName: string;
  jibun: string | null;
  aptName: string;
};

export type ApartmentLite = { id: string; pnu: string | null; lotAddress: string | null; names: string[] };

export type PendingReason =
  | "NO_APT_SEQ"
  | "SEQ_MULTI_PNU"
  | "SEQ_MULTI_ADDRESS"
  | "PNU_SHARED_BY_SEQS"
  | "NOT_IN_REFERENCE"
  | "MULTIPLE_CANDIDATES"
  | "NAME_MISMATCH"
  | "ADDRESS_CONFLICT";

export type SeqDecision =
  | { status: "CONFIRMED"; apartmentId: string; rule: "PNU+NAME" | "LOT_ADDRESS+NAME"; evidence: Record<string, unknown> }
  | { status: "PENDING"; reason: PendingReason; candidateIds: string[]; rule: string; evidence: Record<string, unknown> };

export type TxDecision =
  | { txId: string; status: "CONFIRMED"; apartmentId: string; rule: string; aptSeq: string }
  | { txId: string; status: "PENDING"; reason: PendingReason; candidateId: string | null; rule: string; aptSeq: string | null };

const CITY_NAMES: Record<string, string> = { "50110": "제주특별자치도 제주시", "50130": "제주특별자치도 서귀포시" };

// "태봉그린피아(101,102,103동)" → "태봉그린피아", "서진아파트" → "서진", "e-편한세상" → "e편한세상"
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*동[^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]/g, "")
    .replace(/아파트$/, "");
}

export const lotAddressKey = (sggCode: string, umdName: string, jibun: string | null) =>
  jibun ? `${CITY_NAMES[sggCode] ?? sggCode} ${umdName.trim()} ${jibun.trim()}` : null;

const txAddress = (t: TxLite) => lotAddressKey(t.sggCode, t.umdName, t.jibun);

export function matchAll(txs: TxLite[], apartments: ApartmentLite[]): { seqs: Map<string, SeqDecision>; txs: TxDecision[] } {
  const byPnu = new Map<string, ApartmentLite[]>();
  const byLot = new Map<string, ApartmentLite[]>();
  for (const a of apartments) {
    if (a.pnu) byPnu.set(a.pnu, [...(byPnu.get(a.pnu) ?? []), a]);
    if (a.lotAddress) byLot.set(a.lotAddress, [...(byLot.get(a.lotAddress) ?? []), a]);
  }
  const groups = new Map<string, TxLite[]>();
  for (const t of txs) if (t.aptSeq) groups.set(t.aptSeq, [...(groups.get(t.aptSeq) ?? []), t]);

  // Which aptSeqs share each parcel (a parcel used by two source complexes is ambiguous).
  const seqsByPnu = new Map<string, Set<string>>();
  for (const t of txs) if (t.aptSeq && t.pnu) seqsByPnu.set(t.pnu, (seqsByPnu.get(t.pnu) ?? new Set()).add(t.aptSeq));

  const seqs = new Map<string, SeqDecision>();
  for (const [seq, rows] of groups) {
    const pnus = [...new Set(rows.map((r) => r.pnu).filter((p): p is string => !!p))];
    const addresses = [...new Set(rows.map(txAddress).filter((a): a is string => !!a))];
    const names = [...new Set(rows.map((r) => r.aptName))];
    const evidence: Record<string, unknown> = { pnus, addresses, names };
    let rule: "PNU+NAME" | "LOT_ADDRESS+NAME";
    let candidates: ApartmentLite[];
    if (pnus.length > 1) {
      seqs.set(seq, { status: "PENDING", reason: "SEQ_MULTI_PNU", candidateIds: [], rule: "PNU", evidence });
      continue;
    }
    if (pnus.length === 1) {
      if ((seqsByPnu.get(pnus[0]!)?.size ?? 0) > 1) {
        evidence.sharedWith = [...seqsByPnu.get(pnus[0]!)!].filter((s) => s !== seq);
        seqs.set(seq, { status: "PENDING", reason: "PNU_SHARED_BY_SEQS", candidateIds: (byPnu.get(pnus[0]!) ?? []).map((a) => a.id), rule: "PNU", evidence });
        continue;
      }
      rule = "PNU+NAME";
      candidates = byPnu.get(pnus[0]!) ?? [];
    } else {
      // Rent-only complexes: no parcel id, use the exact lot address instead.
      if (addresses.length !== 1) {
        seqs.set(seq, { status: "PENDING", reason: addresses.length ? "SEQ_MULTI_ADDRESS" : "NOT_IN_REFERENCE", candidateIds: [], rule: "LOT_ADDRESS", evidence });
        continue;
      }
      rule = "LOT_ADDRESS+NAME";
      candidates = byLot.get(addresses[0]!) ?? [];
    }
    if (candidates.length === 0) {
      seqs.set(seq, { status: "PENDING", reason: "NOT_IN_REFERENCE", candidateIds: [], rule, evidence });
      continue;
    }
    if (candidates.length > 1) {
      seqs.set(seq, { status: "PENDING", reason: "MULTIPLE_CANDIDATES", candidateIds: candidates.map((c) => c.id), rule, evidence });
      continue;
    }
    const apt = candidates[0]!;
    const refNames = new Set(apt.names.map(normalizeName));
    // Every name the source used for this complex must match a reference name.
    if (!names.every((n) => refNames.has(normalizeName(n)))) {
      evidence.referenceNames = apt.names;
      seqs.set(seq, { status: "PENDING", reason: "NAME_MISMATCH", candidateIds: [apt.id], rule, evidence });
      continue;
    }
    seqs.set(seq, { status: "CONFIRMED", apartmentId: apt.id, rule, evidence });
  }

  // Per transaction: inherit the complex decision, but a row whose own address disagrees with the
  // complex's address (e.g. a rent row filed under a sale complex's aptSeq) is held back.
  const seqAddress = new Map<string, string | null>();
  for (const [seq, rows] of groups) {
    const fromSale = rows.find((r) => r.tradeType === "sale" && txAddress(r));
    seqAddress.set(seq, fromSale ? txAddress(fromSale) : txAddress(rows[0]!));
  }
  const out: TxDecision[] = txs.map((t) => {
    if (!t.aptSeq) return { txId: t.id, status: "PENDING", reason: "NO_APT_SEQ", candidateId: null, rule: "-", aptSeq: null };
    const d = seqs.get(t.aptSeq)!;
    if (d.status === "PENDING") return { txId: t.id, status: "PENDING", reason: d.reason, candidateId: d.candidateIds.length === 1 ? d.candidateIds[0]! : null, rule: d.rule, aptSeq: t.aptSeq };
    const addr = txAddress(t);
    if (addr && addr !== seqAddress.get(t.aptSeq)) {
      return { txId: t.id, status: "PENDING", reason: "ADDRESS_CONFLICT", candidateId: d.apartmentId, rule: d.rule, aptSeq: t.aptSeq };
    }
    return { txId: t.id, status: "CONFIRMED", apartmentId: d.apartmentId, rule: d.rule, aptSeq: t.aptSeq };
  });
  return { seqs, txs: out };
}

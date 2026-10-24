import { describe, expect, it } from "vitest";
import { matchAll, normalizeName, type ApartmentLite, type TxLite } from "../server/match/engine";

let n = 0;
const sale = (over: Partial<TxLite>): TxLite => ({
  id: String(++n), tradeType: "sale", aptSeq: "S1", pnu: "5011013700100010000", sggCode: "50110",
  umdName: "연동", jibun: "1-0", aptName: "한라", ...over,
});
const rent = (over: Partial<TxLite>): TxLite => sale({ tradeType: "rent", pnu: null, ...over });
const apt = (id: string, over: Partial<ApartmentLite> = {}): ApartmentLite => ({
  id, pnu: "5011013700100010000", lotAddress: "제주특별자치도 제주시 연동 1-0", names: ["한라"], ...over,
});
const decisionOf = (r: ReturnType<typeof matchAll>, txId: string) => r.txs.find((d) => d.txId === txId)!;

describe("normalizeName", () => {
  it("ignores spacing, punctuation, an 아파트 suffix and parenthesised dong lists only", () => {
    expect(normalizeName("태봉그린피아(101,102,103동)")).toBe(normalizeName("태봉그린피아"));
    expect(normalizeName("서진")).toBe(normalizeName("서진아파트"));
    expect(normalizeName("e-편한세상 연동")).toBe(normalizeName("e편한세상연동"));
    expect(normalizeName("부영(2차)")).not.toBe(normalizeName("외도부영2차"));
  });
});

describe("matchAll", () => {
  it("confirms a sale by PNU + name and lets rent rows of the same complex inherit it", () => {
    const s = sale({});
    const r = rent({});
    const res = matchAll([s, r], [apt("A")]);
    expect(decisionOf(res, s.id)).toMatchObject({ status: "CONFIRMED", apartmentId: "A", rule: "PNU+NAME" });
    expect(decisionOf(res, r.id)).toMatchObject({ status: "CONFIRMED", apartmentId: "A" });
  });

  it("never links by name alone: same name at another parcel stays NOT_IN_REFERENCE", () => {
    const s = sale({ pnu: "5011013700100020000", jibun: "2-0" });
    const res = matchAll([s], [apt("A")]); // apartment "한라" exists, but on a different parcel
    expect(decisionOf(res, s.id)).toMatchObject({ status: "PENDING", reason: "NOT_IN_REFERENCE" });
  });

  it("splits same-named complexes by parcel", () => {
    const a = sale({ aptSeq: "S1" });
    const b = sale({ aptSeq: "S2", pnu: "5011010100100050000", umdName: "일도일동", jibun: "5-0" });
    const res = matchAll([a, b], [apt("A"), apt("B", { pnu: "5011010100100050000", lotAddress: "제주특별자치도 제주시 일도일동 5-0" })]);
    expect(decisionOf(res, a.id)).toMatchObject({ status: "CONFIRMED", apartmentId: "A" });
    expect(decisionOf(res, b.id)).toMatchObject({ status: "CONFIRMED", apartmentId: "B" });
  });

  it("holds back multiple candidates on one parcel", () => {
    const s = sale({});
    const res = matchAll([s], [apt("A"), apt("B")]);
    expect(decisionOf(res, s.id)).toMatchObject({ status: "PENDING", reason: "MULTIPLE_CANDIDATES", candidateId: null });
  });

  it("holds back a parcel used by two source complexes", () => {
    const a = sale({ aptSeq: "S1", aptName: "주공3" });
    const b = sale({ aptSeq: "S2", aptName: "주공2차" });
    const res = matchAll([a, b], [apt("A", { names: ["주공3"] })]);
    expect(decisionOf(res, a.id)).toMatchObject({ status: "PENDING", reason: "PNU_SHARED_BY_SEQS" });
    expect(decisionOf(res, b.id)).toMatchObject({ status: "PENDING", reason: "PNU_SHARED_BY_SEQS" });
  });

  it("holds back a unique parcel whose names disagree, keeping the candidate for review", () => {
    const s = sale({ aptName: "부영(2차)" });
    const res = matchAll([s], [apt("A", { names: ["외도부영2차", "부영아파트"] })]);
    expect(decisionOf(res, s.id)).toMatchObject({ status: "PENDING", reason: "NAME_MISMATCH", candidateId: "A" });
  });

  it("requires every source name of a complex to match", () => {
    const a = sale({ aptName: "한라" });
    const b = rent({ aptName: "백두" });
    const res = matchAll([a, b], [apt("A")]);
    expect(res.txs.every((d) => d.status === "PENDING")).toBe(true);
  });

  it("matches rent-only complexes by exact lot address + name", () => {
    const r = rent({ aptSeq: "R1" });
    const res = matchAll([r], [apt("A", { pnu: null })]);
    expect(decisionOf(res, r.id)).toMatchObject({ status: "CONFIRMED", apartmentId: "A", rule: "LOT_ADDRESS+NAME" });
    const elsewhere = rent({ aptSeq: "R2", jibun: "1-1" });
    expect(decisionOf(matchAll([elsewhere], [apt("A")]), elsewhere.id)).toMatchObject({ status: "PENDING", reason: "NOT_IN_REFERENCE" });
  });

  it("holds back a row whose address conflicts with its complex", () => {
    const s = sale({});
    const odd = rent({ jibun: "9-9" });
    const res = matchAll([s, odd], [apt("A")]);
    expect(decisionOf(res, s.id)).toMatchObject({ status: "CONFIRMED" });
    expect(decisionOf(res, odd.id)).toMatchObject({ status: "PENDING", reason: "ADDRESS_CONFLICT", candidateId: "A" });
  });

  it("holds back complexes with inconsistent source data", () => {
    const a = sale({ aptSeq: "S9" });
    const b = sale({ aptSeq: "S9", pnu: "5011013700100020000" });
    expect(decisionOf(matchAll([a, b], [apt("A")]), a.id)).toMatchObject({ status: "PENDING", reason: "SEQ_MULTI_PNU" });
    const r1 = rent({ aptSeq: "R9", jibun: "1-0" });
    const r2 = rent({ aptSeq: "R9", jibun: "3-0" });
    expect(decisionOf(matchAll([r1, r2], [apt("A")]), r1.id)).toMatchObject({ status: "PENDING", reason: "SEQ_MULTI_ADDRESS" });
    const none = sale({ aptSeq: null });
    expect(decisionOf(matchAll([none], [apt("A")]), none.id)).toMatchObject({ status: "PENDING", reason: "NO_APT_SEQ" });
  });
});

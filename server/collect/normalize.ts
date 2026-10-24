import type { RawItem, SourceId } from "./molit";

export type NormalizedTx = {
  tradeType: "sale" | "rent";
  naturalKey: string;
  sourceAptSeq: string | null;
  sggCode: string;
  umdCode: string | null;
  umdName: string;
  jibun: string | null;
  aptNameRaw: string;
  aptDong: string | null;
  contractDate: string; // YYYY-MM-DD
  areaM2: string; // decimal string as received
  floor: number | null;
  salePrice: number | null; // KRW
  deposit: number | null; // KRW
  monthlyRent: number | null; // KRW
  contractType: string | null;
  contractTerm: string | null;
  cancelledOn: string | null;
  registeredOn: string | null;
  recordStatus: "ACTIVE" | "CANCELLED";
  // Sale-only parcel parts used to build the PNU for matching (TASK-005).
  pnu: string | null;
};

export type NormalizeResult = { ok: true; tx: NormalizedTx } | { ok: false; reason: string };

const MANWON = 10_000;

// "40,300" (만원) → 403,000,000 원
export function parseManwon(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!/^(\d{1,3}(,\d{3})*|\d+)$/.test(s)) return null;
  return Number(s.replace(/,/g, "")) * MANWON;
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// "26.09.28" → "2026-09-28"; blank → null; anything else → undefined (invalid).
export function parseShortDate(v: string | undefined): string | null | undefined {
  const s = (v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(s);
  if (!m) return undefined;
  return isoDate(2000 + Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined;
}

const blankToNull = (v: string | undefined) => ((v ?? "").trim() ? (v ?? "").trim() : null);

// Normalizes one source row. Rows that cannot be read safely are rejected with a reason, never guessed.
export function normalizeItem(source: SourceId, it: RawItem, expect: { sggCode: string; dealYmd: string }): NormalizeResult {
  const sggCode = (it.sggCd ?? "").trim();
  if (sggCode !== expect.sggCode) return { ok: false, reason: "SGG_MISMATCH" };
  const date = isoDate(Number(it.dealYear), Number(it.dealMonth), Number(it.dealDay));
  if (!date) return { ok: false, reason: "BAD_DATE" };
  if (date.slice(0, 7).replace("-", "") !== expect.dealYmd) return { ok: false, reason: "MONTH_MISMATCH" };
  const area = (it.excluUseAr ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(area) || Number(area) <= 0) return { ok: false, reason: "BAD_AREA" };
  const floorRaw = (it.floor ?? "").trim();
  if (floorRaw && !/^-?\d+$/.test(floorRaw)) return { ok: false, reason: "BAD_FLOOR" };
  const floor = floorRaw ? Number(floorRaw) : null;
  const aptNameRaw = (it.aptNm ?? "").trim();
  const umdName = (it.umdNm ?? "").trim();
  if (!aptNameRaw || !umdName) return { ok: false, reason: "MISSING_NAME" };
  const registeredOn = parseShortDate(it.rgstDate);
  if (registeredOn === undefined) return { ok: false, reason: "BAD_REGISTERED_DATE" };

  const jibun = blankToNull(it.jibun);
  const aptSeq = blankToNull(it.aptSeq);
  const common = { sggCode, umdName, jibun, aptNameRaw, aptSeq, area, floor, date };

  if (source === "MOLIT_SALE") {
    const salePrice = parseManwon(it.dealAmount);
    if (!salePrice) return { ok: false, reason: "BAD_AMOUNT" };
    const cancelled = (it.cdealType ?? "").trim() === "O";
    const cancelledOn = parseShortDate(it.cdealDay);
    if (cancelledOn === undefined) return { ok: false, reason: "BAD_CANCEL_DATE" };
    if (cancelled && !cancelledOn) return { ok: false, reason: "CANCEL_WITHOUT_DATE" };
    const parts = [it.umdCd, it.landCd, it.bonbun, it.bubun].map((v) => (v ?? "").trim());
    const pnu = /^\d{5}$/.test(parts[0]!) && /^\d$/.test(parts[1]!) && /^\d{4}$/.test(parts[2]!) && /^\d{4}$/.test(parts[3]!)
      ? `${sggCode}${parts.join("")}` : null;
    return {
      ok: true,
      tx: {
        tradeType: "sale",
        // Excludes fields that change after reporting (cancellation, registration date, dong).
        naturalKey: naturalKey("sale", common, [String(salePrice)]),
        sourceAptSeq: aptSeq, sggCode, umdCode: blankToNull(it.umdCd), umdName, jibun, aptNameRaw,
        aptDong: blankToNull(it.aptDong), contractDate: date, areaM2: area, floor,
        salePrice, deposit: null, monthlyRent: null, contractType: null, contractTerm: null,
        cancelledOn: cancelled ? cancelledOn : null, registeredOn,
        recordStatus: cancelled ? "CANCELLED" : "ACTIVE", pnu,
      },
    };
  }

  const deposit = parseManwon(it.deposit);
  const monthlyRent = parseManwon(it.monthlyRent);
  if (deposit === null || monthlyRent === null) return { ok: false, reason: "BAD_AMOUNT" };
  const contractType = blankToNull(it.contractType);
  const contractTerm = blankToNull(it.contractTerm);
  return {
    ok: true,
    tx: {
      tradeType: "rent",
      naturalKey: naturalKey("rent", common, [String(deposit), String(monthlyRent), contractType ?? "", contractTerm ?? ""]),
      sourceAptSeq: aptSeq, sggCode, umdCode: null, umdName, jibun, aptNameRaw, aptDong: null,
      contractDate: date, areaM2: area, floor, salePrice: null, deposit, monthlyRent, contractType, contractTerm,
      cancelledOn: null, registeredOn: null, recordStatus: "ACTIVE", pnu: null,
    },
  };
}

function naturalKey(
  type: string,
  c: { sggCode: string; umdName: string; jibun: string | null; aptNameRaw: string; aptSeq: string | null; area: string; floor: number | null; date: string },
  amounts: string[],
): string {
  return [type, c.sggCode, c.umdName, c.jibun ?? "", c.aptNameRaw, c.aptSeq ?? "", c.area, c.floor ?? "", c.date, ...amounts].join("|");
}

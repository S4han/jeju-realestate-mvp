// Parsing of REB 공동주택 단지 식별정보 (AptIdInfoSvc getAptInfo) rows.
// Field names verified against live responses in TASK-001 (docs/API_VERIFICATION.md).

export type RebRow = {
  COMPLEX_PK: string;
  PNU: string | null;
  ADRES: string | null;
  ROAD_ADRES: string | null;
  COMPLEX_NM1: string | null;
  COMPLEX_NM2: string | null;
  COMPLEX_NM3: string | null;
  COMPLEX_GB_CD: string;
  DONG_CNT: number | null;
  UNIT_CNT: number | null;
  USEAPR_DT: string | null;
};

export type ApartmentInput = {
  rebComplexPk: string;
  name: string;
  aliases: { name: string; source: "REB_NM1" | "REB_NM2" | "REB_NM3" }[];
  cityCode: "50110" | "50130";
  legalDongCode: string;
  pnu: string;
  lotAddress: string | null;
  roadAddress: string | null;
  unitCount: number | null;
  approvedOn: string | null; // YYYY-MM-DD
};

export type RebParseResult = { apartments: ApartmentInput[]; skipped: { complexPk: string; reason: string }[] };

const CITY_NAMES = { "50110": "제주특별자치도 제주시", "50130": "제주특별자치도 서귀포시" } as const;
const APARTMENT = "1";

function toIsoDate(yyyymmdd: string | null): string | null {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return null;
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// Keeps Jeju apartments (단지종류 1) only; anything malformed is reported, not guessed.
export function parseRebApartments(rows: RebRow[]): RebParseResult {
  const apartments: ApartmentInput[] = [];
  const skipped: RebParseResult["skipped"] = [];
  for (const r of rows) {
    if (r.COMPLEX_GB_CD !== APARTMENT) continue;
    const pnu = clean(r.PNU);
    const city = pnu.slice(0, 5);
    if (!/^\d{19}$/.test(pnu)) {
      skipped.push({ complexPk: r.COMPLEX_PK, reason: "INVALID_PNU" });
      continue;
    }
    if (city !== "50110" && city !== "50130") {
      skipped.push({ complexPk: r.COMPLEX_PK, reason: "NOT_JEJU" });
      continue;
    }
    const nm1 = clean(r.COMPLEX_NM1);
    if (!nm1) {
      skipped.push({ complexPk: r.COMPLEX_PK, reason: "NO_NAME" });
      continue;
    }
    const aliases: ApartmentInput["aliases"] = [];
    const seen = new Set<string>();
    for (const [source, value] of [["REB_NM1", r.COMPLEX_NM1], ["REB_NM2", r.COMPLEX_NM2], ["REB_NM3", r.COMPLEX_NM3]] as const) {
      const v = clean(value);
      if (v && !seen.has(v)) {
        seen.add(v);
        aliases.push({ name: v, source });
      }
    }
    const road = clean(r.ROAD_ADRES);
    apartments.push({
      rebComplexPk: r.COMPLEX_PK,
      name: nm1,
      aliases,
      cityCode: city,
      legalDongCode: pnu.slice(0, 10),
      pnu,
      lotAddress: clean(r.ADRES) || null,
      roadAddress: road ? `${CITY_NAMES[city]} ${road}` : null,
      unitCount: typeof r.UNIT_CNT === "number" && r.UNIT_CNT >= 0 ? r.UNIT_CNT : null,
      approvedOn: toIsoDate(r.USEAPR_DT),
    });
  }
  return { apartments, skipped };
}

// Region codes for Phase 3 (P3-D2): legal dong codes are 10 digits — city(5) + eup/myeon/dong(3) + ri(2).
// A ri code rolls up to its eup/myeon by zeroing the last two digits; cities end in 00000.
export const JEJU_CITIES = ["50110", "50130"] as const;

const LEGAL_CODE = /^50(110|130)\d{5}$/;

/** Display region (eup/myeon/dong) of a 10-digit legal dong code, or null if it is not a Jeju dong/ri code. */
export function umdOf(legalCode: string | null | undefined): string | null {
  if (!legalCode || !LEGAL_CODE.test(legalCode) || legalCode.slice(5, 8) === "000") return null;
  return `${legalCode.slice(0, 8)}00`;
}

export const cityRegionOf = (code: string) => `${code.slice(0, 5)}00000`;

/** A deal's own MOLIT code (sgg 5 + umdCd 5) points at the same eup/myeon/dong as the apartment code. */
export function dealAgreesWithApartment(sggCode: string, umdCode: string | null, apartmentLegalCode: string): boolean | null {
  if (!umdCode) return null;
  return umdOf(`${sggCode}${umdCode}`) === umdOf(apartmentLegalCode);
}

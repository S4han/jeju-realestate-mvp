// Synthetic MOLIT responses shaped like the live ones captured in TASK-001 (fictional values).
export type Item = Record<string, string>;

export const saleItem = (over: Item = {}): Item => ({
  aptDong: " ", aptNm: "테스트하이츠", aptSeq: "50110-9001", bonbun: "1394", bubun: "0001", buildYear: "2017",
  buyerGbn: "개인", cdealDay: " ", cdealType: " ", dealAmount: "40,300", dealDay: "18", dealMonth: "8", dealYear: "2026",
  dealingGbn: "중개거래", estateAgentSggNm: "제주 제주시", excluUseAr: "84.729", floor: "3", jibun: "1394-1",
  landCd: "1", landLeaseholdGbn: "N", rgstDate: " ", roadNm: "테스트로", sggCd: "50110", slerGbn: "개인",
  umdCd: "12500", umdNm: "오라이동", ...over,
});

export const rentItem = (over: Item = {}): Item => ({
  aptNm: "테스트파크", aptSeq: "50110-9002", buildYear: "2020", contractTerm: "26.09~28.09", contractType: "신규",
  dealDay: "28", dealMonth: "8", dealYear: "2026", deposit: "11,038", excluUseAr: "84.8806", floor: "4", jibun: "717",
  monthlyRent: "51", preDeposit: " ", preMonthlyRent: " ", sggCd: "50110", umdNm: "월평동", useRRRight: " ", ...over,
});

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function responseXml(items: Item[], totalCount = items.length, page = 1, rows = 1000, resultCode = "000"): string {
  const body = items.map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join("")}</item>`).join("");
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?><response><header><resultCode>${resultCode}</resultCode><resultMsg>${resultCode === "000" ? "OK" : "ERR"}</resultMsg></header><body><items>${body}</items><numOfRows>${rows}</numOfRows><pageNo>${page}</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

export const gatewayErrorXml = (code: string) =>
  `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

// 598,000,000 → "5억 9,800만원", 20,000,000 → "2,000만원"
export function formatKrw(won: number | null): string {
  if (won === null) return "-";
  const man = Math.round(won / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString("ko-KR")}만원`;
  if (eok) return `${eok}억원`;
  return `${rest.toLocaleString("ko-KR")}만원`;
}

export const formatArea = (m2: number) => `${m2.toFixed(2)}㎡ (${(m2 / 3.3058).toFixed(1)}평)`;

export const formatFloor = (f: number | null) => (f === null ? "층 정보 없음" : f < 0 ? `지하 ${-f}층` : `${f}층`);

export function formatRent(deposit: number | null, monthly: number | null): string {
  if (deposit === null) return "-";
  return monthly ? `보증금 ${formatKrw(deposit)} / 월 ${formatKrw(monthly)}` : `전세 ${formatKrw(deposit)}`;
}

export const CITY_LABEL: Record<string, string> = { "50110": "제주시", "50130": "서귀포시" };

const stripCity = (s: string) => s.replace(/^제주특별자치도\s+(제주시|서귀포시)\s+/, "");

// Road address plus lot number: REB sometimes splits one complex into several (e.g. 가동 / 나,다동)
// that share a road address but not a parcel, so the lot number is what tells them apart (AT-003).
export function displayAddress(road: string | null, lot: string | null): string {
  if (road && lot) return `${stripCity(road)} (${stripCity(lot)})`;
  return road ? stripCity(road) : lot ? stripCity(lot) : "주소 정보 없음";
}

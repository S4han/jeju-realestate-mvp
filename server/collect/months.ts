// Contract months are counted in Korea time; "recent 12 months" includes the current month (PRD).
export function currentYmdKst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}${m}`;
}

export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now); // YYYY-MM-DD
}

export function recentMonths(count: number, now: Date = new Date()): string[] {
  const ymd = currentYmdKst(now);
  let y = Number(ymd.slice(0, 4));
  let m = Number(ymd.slice(4));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  return out.reverse();
}

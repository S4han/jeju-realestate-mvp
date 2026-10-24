import { describe, expect, it } from "vitest";
import { displayAddress, formatArea, formatFloor, formatKrw, formatRent } from "../src/format";

describe("format", () => {
  it("formats KRW in 억/만원", () => {
    expect(formatKrw(598_000_000)).toBe("5억 9,800만원");
    expect(formatKrw(500_000_000)).toBe("5억원");
    expect(formatKrw(20_000_000)).toBe("2,000만원");
    expect(formatKrw(null)).toBe("-");
  });
  it("formats rent, area and floor", () => {
    expect(formatRent(20_000_000, 1_330_000)).toBe("보증금 2,000만원 / 월 133만원");
    expect(formatRent(300_000_000, 0)).toBe("전세 3억원");
    expect(formatArea(84.85)).toBe("84.85㎡ (25.7평)");
    expect(formatFloor(-1)).toBe("지하 1층");
    expect(formatFloor(null)).toBe("층 정보 없음");
  });

  it("shows road address with the lot number so split complexes stay distinguishable", () => {
    const a = displayAddress("제주특별자치도 제주시 용화로5길 13", "제주특별자치도 제주시 용담이동 609-3");
    const b = displayAddress("제주특별자치도 제주시 용화로5길 13", "제주특별자치도 제주시 용담이동 609-68");
    expect(a).toBe("용화로5길 13 (용담이동 609-3)");
    expect(a).not.toBe(b);
    expect(displayAddress(null, null)).toBe("주소 정보 없음");
  });
});

// E2E for the Phase 3 region analysis page (P3-TASK-006) at phone width, with a fake Kakao SDK.
// Two API servers on the same DB — flag ON and OFF — each behind its own Vite server, plus one Vite server
// without a map key (map failure → region table).
//   OFF: no entry on the dashboard, #/regions stays on the dashboard, only the status probe hits /api/v3.
//   ON : entry, city map → eup/myeon/dong map, legend, table, detail, complexes, compare, metric switch.
// Usage: DATABASE_URL=... node tests/e2e/phase3.e2e.mjs   (needs an ACTIVE region set; E2E_SCREENSHOT_DIR optional)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const fakeSdk = readFileSync(path.join(here, "fake-kakao-sdk-p3.js"), "utf8");
const shots = process.env.E2E_SCREENSHOT_DIR;

const apiEnv = (flag) => ({ ...process.env, PHASE3_REGION_ANALYSIS_ENABLED: flag, P3_CURSOR_SECRET: "e2e-p3-cursor-secret-0123456789abcdef" });
const servers = {
  on: { api: 3071, web: 5201, flag: "true", key: "E2E-FAKE-KEY" },
  off: { api: 3072, web: 5202, flag: "", key: "E2E-FAKE-KEY" },
  nokey: { api: 3071, web: 5203, flag: "true", key: "" },
};
const procs = [
  ...[servers.on, servers.off].map((s) => spawn("node", ["--import", "tsx", "server/dev-server.ts"], { stdio: "ignore", detached: true, env: { ...apiEnv(s.flag), API_PORT: String(s.api) } })),
  ...Object.values(servers).map((s) =>
    spawn("npx", ["vite", "--port", String(s.web), "--strictPort"], { stdio: "ignore", detached: true, env: { ...process.env, API_PORT: String(s.api), VITE_KAKAO_MAP_JS_KEY: s.key } }),
  ),
];
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid); } catch {} });
process.on("exit", stop);

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}
const settle = (page) => page.waitForTimeout(800);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  for (const s of [servers.on, servers.off]) await waitFor(`http://localhost:${s.api}/api/system/data-status`);
  for (const s of Object.values(servers)) await waitFor(`http://localhost:${s.web}/`);
  const browser = await chromium.launch();
  const open = async (s, hash = "#/") => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const v3 = new Map();
    const errors = [];
    page.on("request", (r) => r.url().includes("/api/v3/") && v3.set(r, new URL(r.url()).pathname));
    page.on("requestfailed", (r) => v3.delete(r));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/dapi.kakao.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: fakeSdk }));
    await page.goto(`http://localhost:${s.web}/${hash}`);
    await page.getByText("제주 아파트 실거래").first().waitFor().catch(() => {});
    await settle(page);
    return { page, v3: () => [...v3.values()], errors };
  };

  // Flag OFF: Phase 1 dashboard unchanged, no entry, no data calls.
  {
    const { page, v3, errors } = await open(servers.off);
    check("OFF: no region entry on the dashboard", (await page.getByText("지역 분석 →").count()) === 0);
    await page.goto(`http://localhost:${servers.off.web}/#/regions`);
    await settle(page);
    check("OFF: #/regions stays on the dashboard", (await page.getByRole("heading", { name: "지역 분석" }).count()) === 0);
    check("OFF: only status probes hit /api/v3", v3().every((p) => p.endsWith("/status")), JSON.stringify(v3()));
    check("OFF: no page errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // Flag ON.
  {
    const { page, errors } = await open(servers.on);
    check("ON: entry shown on the dashboard", (await page.getByText("지역 분석 →").count()) === 1);
    await page.getByText("지역 분석 →").click();
    await page.getByRole("heading", { name: "지역 분석" }).waitFor();
    await page.getByText("시별 ㎡당 중위가격").waitFor();
    await settle(page);
    const allParts = await page.locator("[data-region]").count();
    check("ON: city map draws all eup/myeon/dong polygons (islands are separate parts)", allParts >= 74, String(allParts));
    check("ON: city table has 2 rows", (await page.locator('section[aria-label="지역 표"] tbody tr').count()) === 2);
    if (shots) await page.screenshot({ path: `${shots}/p3-city.png`, fullPage: true });

    await page.locator('section[aria-label="지역 표"]').getByRole("button", { name: /제주시/ }).click();
    await page.getByText("읍면동별 ㎡당 중위가격").waitFor();
    await settle(page);
    const rows = await page.locator('section[aria-label="지역 표"] tbody tr').count();
    check("ON: 제주시 shows its 47 eup/myeon/dong", rows === 47, String(rows));
    const jejuParts = await page.locator("[data-region]").count();
    check("ON: map shows only 제주시 polygons", jejuParts > 0 && jejuParts < allParts, `${jejuParts} of ${allParts}`);
    const legend = await page.locator('section[aria-label="범례"]').innerText();
    check("ON: legend lists classes with ranges, '표본 부족', '아파트 없음'", /만원\/㎡ \(\d+곳\)/.test(legend) && legend.includes("표본 부족") && legend.includes("아파트 없음"), legend.slice(0, 80));
    if (shots) await page.screenshot({ path: `${shots}/p3-jeju.png`, fullPage: true });

    // Select the first region with a price.
    const firstRow = page.locator('section[aria-label="지역 표"] tbody tr').first();
    const regionName = (await firstRow.locator("td").first().innerText()).trim();
    await firstRow.getByRole("button").click();
    await page.locator(`section[aria-label="${regionName} 상세"]`).waitFor();
    await settle(page);
    const detail = page.locator(`section[aria-label="${regionName} 상세"]`);
    check("ON: detail card shows price, count and change", (await detail.getByText("㎡당 중위가격").count()) === 1 && (await detail.getByText("1년 전 대비").count()) === 1);
    check("ON: detail lists traded complexes linking to Phase 1 detail", (await detail.locator('a[href^="#/apartments/"]').count()) > 0);
    check("ON: selected polygon is outlined", (await page.locator('[data-region][data-stroke="3"]').count()) > 0);
    if (shots) await page.screenshot({ path: `${shots}/p3-detail.png`, fullPage: true });

    // Compare with the second region.
    await detail.getByRole("button", { name: "비교에 추가" }).click();
    const second = page.locator('section[aria-label="지역 표"] tbody tr').nth(1);
    const secondName = (await second.locator("td").first().innerText()).trim();
    await second.getByRole("button").click();
    await page.locator(`section[aria-label="${secondName} 상세"]`).getByRole("button", { name: "비교에 추가" }).click();
    await page.locator('section[aria-label="두 지역 비교"] table').waitFor();
    const cmp = await page.locator('section[aria-label="두 지역 비교"]').innerText();
    check("ON: comparison shows both regions", cmp.includes(regionName) && cmp.includes(secondName));
    if (shots) await page.screenshot({ path: `${shots}/p3-compare.png`, fullPage: true });

    // Metric switch → legend in trades.
    await page.getByRole("radio", { name: "거래량" }).click();
    await page.getByText("읍면동별 거래량").waitFor();
    await settle(page);
    check("ON: trade-count legend uses 건", /건 \(\d+곳\)/.test(await page.locator('section[aria-label="범례"]').innerText()));
    await page.getByRole("radio", { name: "최근 12개월" }).click();
    await settle(page);
    check("ON: period switch reloads the footer window", (await page.locator("footer").innerText()).includes("2025.11.01"));
    // 서귀포시 has eup/myeon/dong without apartments → dashed, uncoloured polygons and "아파트 없음" rows.
    await page.getByRole("button", { name: "제주 전체" }).click();
    await page.getByText("시별 거래량").waitFor();
    await page.locator('section[aria-label="지역 표"]').getByRole("button", { name: /서귀포시/ }).click();
    await page.getByText("읍면동별 거래량").waitFor();
    await settle(page);
    check("ON: regions without apartments are dashed and labelled", (await page.locator('[data-region][data-dashed="true"]').count()) > 0 && (await page.locator('section[aria-label="지역 표"]').getByText("아파트 없음").count()) > 0);
    if (shots) await page.screenshot({ path: `${shots}/p3-seogwipo.png`, fullPage: true });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check("ON: no horizontal overflow at 390px", sw <= 390, `scrollWidth ${sw}`);
    check("ON: no page errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // Map failure → table only.
  {
    const { page, errors } = await open(servers.nokey, "#/");
    await page.getByText("지역 분석 →").click();
    await page.getByText("시별 ㎡당 중위가격").waitFor();
    await settle(page);
    check("NO KEY: map replaced by notice + table", (await page.getByText("지도를 불러올 수 없어 지역 표로 보여 드립니다.").count()) === 1 && (await page.locator('section[aria-label="지역 표"] tbody tr').count()) === 2);
    check("NO KEY: no page errors", errors.length === 0, errors.join(" | "));
    if (shots) await page.screenshot({ path: `${shots}/p3-nomap.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  stop();
}
process.exit(failures ? 1 : 0);

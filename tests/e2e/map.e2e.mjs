// E2E for search + map + summary card (TASK-006) against the local dev DB.
// Starts the API and Vite servers, then drives Chromium at phone width.
// Usage: npm run test:e2e   (needs DATABASE_URL with collected data)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const fakeSdk = readFileSync(path.join(here, "fake-kakao-sdk.js"), "utf8");
const shots = process.env.E2E_SCREENSHOT_DIR;

const procs = [
  spawn("npm", ["run", "dev:api"], { stdio: "ignore", detached: true }),
  spawn("npx", ["vite", "--port", "5179", "--strictPort"], { stdio: "ignore", detached: true, env: { ...process.env, VITE_KAKAO_MAP_JS_KEY: "E2E-FAKE-KEY" } }),
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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  await waitFor("http://localhost:3001/api/system/data-status");
  await waitFor("http://localhost:5179/");
  const browser = await chromium.launch();
  const ctx = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 };

  // 1) Map available (fake SDK)
  const page = await browser.newPage(ctx);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const mapRequests = [];
  page.on("request", (r) => r.url().includes("/api/apartments/map") && mapRequests.push(new URL(r.url()).searchParams));
  await page.route("https://dapi.kakao.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSdk }));
  await page.goto("http://localhost:5179/");
  await page.waitForSelector("[data-marker]");
  const count = Number(await page.getAttribute("[data-markers]", "data-count"));
  check("markers load for the visible bounds", count > 0 && mapRequests[0]?.get("bbox")?.split(",").length === 4, `${count} markers, bbox=${mapRequests[0]?.get("bbox")}`);
  if (shots) await page.screenshot({ path: `${shots}/task006_map.png` });

  await page.click("[data-marker] >> nth=0");
  await page.waitForSelector("section[aria-label='단지 요약'] >> text=최근 12개월 매매");
  check("marker click opens the summary card", true);

  await page.fill("input[role=combobox]", "노형뜨란");
  await page.click("li[role=option] >> text=노형뜨란채");
  await page.waitForSelector("section[aria-label='단지 요약'] h2 >> text=노형뜨란채");
  const center = await page.evaluate(() => ({ lat: window.__fakeMap.center.getLat(), level: window.__fakeMap.level }));
  check("search selection moves the map and opens the card", Math.abs(center.lat - 33.4875) < 0.001 && center.level === 4, JSON.stringify(center));
  if (shots) await page.screenshot({ path: `${shots}/task006_card.png` });

  const before = mapRequests.length;
  await page.selectOption("select[aria-label='지역 선택']", "50130");
  await page.waitForFunction((n) => performance.getEntriesByType("resource").filter((e) => e.name.includes("city_code=50130")).length > 0, before);
  check("city filter re-queries markers", mapRequests.slice(before).some((q) => q.get("city_code") === "50130"));

  await page.selectOption("select[aria-label='지역 선택']", "");
  await page.fill("input[role=combobox]", "남양맨션");
  await page.waitForFunction(() => {
    const opts = [...document.querySelectorAll("li[role=option]")];
    return opts.length >= 2 && opts.every((o) => o.textContent.includes("남양맨션"));
  });
  const addrs = await page.$$eval("li[role=option] div:nth-child(2)", (els) => els.map((e) => e.textContent));
  check("same-named complexes are listed with different addresses", addrs.length >= 2 && new Set(addrs).size === addrs.length, addrs.join(" | "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal overflow at 390px", !overflow);
  check("no page errors", errors.length === 0, errors.join("; "));
  await page.close();

  // 2) Map SDK blocked → list search fallback
  const p2 = await browser.newPage(ctx);
  await p2.route("https://dapi.kakao.com/**", (r) => r.abort());
  await p2.goto("http://localhost:5179/");
  await p2.waitForSelector("[role=alert] >> text=목록 검색으로 전환");
  await p2.fill("#list-q", "아라");
  await p2.waitForSelector("main li button");
  await p2.click("main li button >> nth=0");
  await p2.waitForSelector("section[aria-label='단지 요약'] >> text=최근 12개월");
  check("SDK failure switches to list search, which still opens cards", true);
  const mapBtnDisabled = await p2.isDisabled("button[aria-pressed] >> text=지도");
  check("map toggle is disabled after failure", mapBtnDisabled);
  if (shots) await p2.screenshot({ path: `${shots}/task006_fallback.png` });
  await p2.close();

  // 3) Transaction detail (TASK-007)
  const p3 = await browser.newPage(ctx);
  const p3errors = [];
  p3.on("pageerror", (e) => p3errors.push(e.message));
  await p3.route("https://dapi.kakao.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSdk }));
  await p3.goto("http://localhost:5179/");
  await p3.fill("input[role=combobox]", "노형뜨란채");
  await p3.click("li[role=option] >> text=노형뜨란채");
  await p3.click("text=거래 상세보기");
  await p3.waitForSelector("main ul li");
  const saleRows = await p3.$$eval("main ul li", (els) => els.length);
  const summary = await p3.textContent("main p.mb-2");
  check("detail lists confirmed sales (20 per page)", saleRows === 20 && /2025\.11 ~ 2026\.10 · \d+건/.test(summary), `${saleRows} rows, ${summary}`);
  await p3.click("text=더 보기");
  await p3.waitForFunction((n) => document.querySelectorAll("main ul li").length > n, saleRows);
  check("'더 보기' loads the next page", true);
  await p3.click("main ul li >> nth=0 >> button");
  await p3.waitForSelector("main ul li dl >> text=거래금액");
  check("a row expands to show deal details", true);
  if (shots) await p3.screenshot({ path: `${shots}/task007_sale.png` });

  await p3.click("[role=tab] >> text=전월세");
  await p3.waitForSelector("main ul li >> text=/보증금|전세/");
  await p3.click("[aria-label='전용면적 필터'] button >> nth=1");
  await p3.waitForTimeout(400);
  const areas = await p3.$$eval("main ul li button span span:nth-child(2)", (els) => els.map((e) => e.textContent.split("㎡")[0]));
  const chip = (await p3.textContent("[aria-label='전용면적 필터'] button[aria-pressed=true]")).replace("㎡", "");
  check("area chip filters rent rows", areas.length > 0 && areas.every((a) => Math.floor(Number(a)) === Number(chip)), `${chip}㎡: ${areas.slice(0, 5).join(", ")}`);
  await p3.click("[aria-label='전용면적 필터'] button >> nth=0");
  await p3.selectOption("select[aria-label='정렬']", "price_desc");
  await p3.waitForTimeout(400);
  const sorted = await p3.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("type=rent") && e.name.includes("sort=price_desc")));
  const deposits = await p3.$$eval("main ul li button > span > span:first-child", (els) => els.map((e) => e.textContent));
  // Ordering itself is asserted in tests/transactions.db.test.ts; here we check the UI requests it.
  check("price sort is requested and rendered", sorted && deposits.length > 1, deposits.slice(0, 3).join(" / "));
  if (shots) await p3.screenshot({ path: `${shots}/task007_rent.png` });
  check("no page errors on detail", p3errors.length === 0, p3errors.join("; "));

  // Empty result is a normal state, distinct from an outage.
  const pgmod = require("pg");
  const db = new pgmod.Pool({ connectionString: process.env.DATABASE_URL });
  const emptyId = (await db.query("SELECT apartment_id FROM apartments a WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.apartment_id = a.apartment_id) LIMIT 1")).rows[0].apartment_id;
  await db.end();
  await p3.goto(`http://localhost:5179/#/apartments/${emptyId}`);
  await p3.waitForSelector("text=확인된 매매 거래가 없습니다");
  check("apartment without deals shows a normal empty state", (await p3.$("text=불러올 수 없습니다")) === null);

  await p3.route("**/api/apartments/*/transactions*", (r) => r.fulfill({ status: 503, body: "{}" }));
  await p3.reload();
  await p3.waitForSelector("text=거래 정보를 불러올 수 없습니다");
  await p3.unroute("**/api/apartments/*/transactions*");
  await p3.click("text=다시 시도");
  await p3.waitForSelector("text=확인된 매매 거래가 없습니다");
  check("outage shows an error with working retry", true);
  await browser.close();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  stop();
}
console.log(failures ? `${failures} check(s) failed` : "all E2E checks passed");
process.exit(failures ? 1 : 0);

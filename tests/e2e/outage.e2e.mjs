// Failure-mode E2E (AT-015, AT-016, SECURITY_COST.md 오류): DB outage, missing months, delayed data.
// Starts an API server pointed at an unreachable database plus Vite, then checks user-facing messages.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const env = { ...process.env, API_PORT: "3011", DATABASE_URL: "postgres://nobody:nopass@127.0.0.1:1/none" };
const procs = [
  spawn("node", ["--import", "tsx", "server/dev-server.ts"], { stdio: "ignore", detached: true, env }),
  spawn("npx", ["vite", "--port", "5180", "--strictPort"], { stdio: "ignore", detached: true, env: { ...env, VITE_KAKAO_MAP_JS_KEY: "" } }),
];
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid); } catch {} });
process.on("exit", stop);
for (const u of ["http://localhost:3011/api/system/data-status", "http://localhost:5180/"]) {
  for (let i = 0; i < 60; i++) { try { await fetch(u); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
}

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const apiRes = await fetch("http://localhost:3011/api/apartments/search?q=a");
  const apiBody = await apiRes.text();
  check("API answers 503 with a generic message when the DB is down", apiRes.status === 503 && !/127\.0\.0\.1|ECONNREFUSED|nopass/.test(apiBody), `${apiRes.status} ${apiBody}`);

  await page.goto("http://localhost:5180/");
  await page.waitForSelector("text=데이터 서버에 연결할 수 없습니다");
  check("header shows outage, not 'no data'", (await page.$("text=아직 수집된 데이터가 없습니다")) === null);
  await page.waitForSelector("[role=alert] >> text=목록 검색으로 전환");
  await page.fill("#list-q", "노형");
  await page.waitForSelector("text=검색 서버에 연결할 수 없습니다");
  check("list search reports the outage instead of 'no results'", (await page.$("text=일치하는 아파트가 없습니다")) === null);

  await page.goto("http://localhost:5180/#/apartments/27");
  await page.waitForSelector("text=거래 정보를 불러올 수 없습니다");
  check("detail page shows an error with retry during the outage", (await page.$("text=다시 시도")) !== null);

  // Missing month + delayed data are shown as warnings next to the (last good) list.
  await page.route("**/api/apartments/27/transactions*", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      apartment: { id: "27", name: "테스트", city_code: "50110" },
      filter: { type: "sale", from: "2025-11", to: "2026-10", sort: "date_desc", area_min: null, area_max: null },
      page: { page: 1, page_size: 20, total: 1 },
      items: [{ id: "1", trade_type: "sale", contract_date: "2026-04-02", area_m2: 84.9, floor: 3, sale_price: 500000000, deposit: null, monthly_rent: null, contract_type: null, contract_term: null, apt_dong: null, registered_on: null }],
      area_groups: [{ m2: 84, n: 1 }],
      data: { missing_months: ["2026-05", "2026-06"], last_success_at: "2026-10-20T01:00:00Z", delayed: true, source: "국토교통부" },
    }),
  }));
  await page.click("text=다시 시도");
  await page.waitForSelector("text=2026.05, 2026.06 데이터를 수집하지 못해");
  await page.waitForSelector("text=데이터 갱신이 지연되고 있습니다");
  check("missing months and delay are announced while showing last good data", (await page.$("text=5억원")) !== null);
  check("no page errors", errors.length === 0, errors.join("; "));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  stop();
}
console.log(failures ? `${failures} check(s) failed` : "all outage checks passed");
process.exit(failures ? 1 : 0);

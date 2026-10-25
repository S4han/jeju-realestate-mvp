// E2E for the Phase 2 price-analysis tab (P2-TASK-005) at phone width.
// Runs two API servers against the same DB — flag ON and flag OFF — each behind its own Vite server, and checks:
//   OFF: no "가격 분석" tab, and the only /api/v2 request is the single status probe (404); Phase 1 tabs work.
//   ON : the tab renders cards, both charts, evidence paging; "all" shows no prices.
// Usage: DATABASE_URL=... E2E_APARTMENT_ID=1 node tests/e2e/phase2.e2e.mjs   (E2E_SCREENSHOT_DIR optional)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const shots = process.env.E2E_SCREENSHOT_DIR;
const aptId = process.env.E2E_APARTMENT_ID ?? "1";

const servers = { on: { api: 3041, web: 5191, flag: "true" }, off: { api: 3042, web: 5192, flag: "" } };
const procs = Object.values(servers).flatMap((s) => [
  spawn("node", ["--import", "tsx", "server/dev-server.ts"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, API_PORT: String(s.api), PHASE2_PRICE_ANALYSIS_ENABLED: s.flag, P2_CURSOR_SECRET: "e2e-cursor-secret-0123456789abcdefgh" },
  }),
  spawn("npx", ["vite", "--port", String(s.web), "--strictPort"], { stdio: "ignore", detached: true, env: { ...process.env, API_PORT: String(s.api) } }),
]);
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid); } catch {} });
process.on("exit", stop);

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

// Lets pending fetches finish (the Vite dev socket keeps "networkidle" from ever firing).
const settle = (page) => page.waitForTimeout(800);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  for (const s of Object.values(servers)) {
    await waitFor(`http://localhost:${s.api}/api/system/data-status`);
    await waitFor(`http://localhost:${s.web}/`);
  }
  const browser = await chromium.launch();
  const open = async (s) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    // Aborted requests don't count: dev StrictMode mounts effects twice and aborts the first probe.
    const v2req = new Map();
    page.on("request", (r) => r.url().includes("/api/v2/") && v2req.set(r, new URL(r.url()).pathname + new URL(r.url()).search));
    page.on("requestfailed", (r) => v2req.delete(r));
    const v2 = { get list() { return [...v2req.values()]; } };
    page.on("pageerror", (e) => errors.push(e.message));
    const probe = page.waitForResponse((r) => r.url().includes("/api/v2/") && r.url().endsWith("/status"));
    await page.goto(`http://localhost:${s.web}/#/apartments/${aptId}`);
    await page.getByRole("tab", { name: /매매/ }).waitFor();
    await probe;
    await settle(page);
    return { page, v2, errors };
  };

  // Flag OFF: Phase 1 screen unchanged, no analysis tab, no v2 data calls.
  {
    const { page, v2, errors } = await open(servers.off);
    check("OFF: tabs are 매매/전월세 only", (await page.getByRole("tab").count()) === 2);
    check("OFF: only the status probe hit /api/v2", v2.list.length === 1 && v2.list[0].endsWith("/status"), JSON.stringify(v2.list));
    await page.getByRole("tab", { name: /전월세/ }).click();
    await settle(page);
    check("OFF: rent tab still works", (await page.getByRole("tab", { name: /전월세/ }).getAttribute("aria-selected")) === "true");
    check("OFF: no further v2 calls after use", v2.list.length === 1);
    check("OFF: no page errors", errors.length === 0, errors.join(" | "));
    if (shots) await page.screenshot({ path: `${shots}/p2-off.png`, fullPage: true });
    await page.close();
  }

  // Flag ON.
  {
    const { page, v2, errors } = await open(servers.on);
    const tab = page.getByRole("tab", { name: "가격 분석" });
    check("ON: analysis tab shown", (await tab.count()) === 1);
    await tab.click();
    await page.getByText("가격 추이").waitFor();
    await settle(page);
    check("ON: summary cards", (await page.getByText("중위 거래가").count()) === 1 && (await page.getByText("1년 전 대비").count()) === 1);
    check("ON: price chart has deal dots", (await page.locator('svg[aria-label^="가격 추이"] circle[r="4"]').count()) > 0);
    check("ON: volume chart rendered", (await page.locator('svg[aria-label^="월별 거래량"]').count()) === 1);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("ON: no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    if (shots) await page.screenshot({ path: `${shots}/p2-on.png`, fullPage: true });

    const before = await page.locator('section[aria-label="근거 거래"] li').count();
    const more = page.getByRole("button", { name: /더 보기/ }).first();
    if (await more.count()) {
      await more.click();
      await settle(page);
      const after = await page.locator('section[aria-label="근거 거래"] li').count();
      check("ON: evidence paging adds rows", after > before, `${before} → ${after}`);
    }

    // Hover a deal dot → tooltip.
    await page.locator('svg[aria-label^="가격 추이"] g').last().hover();
    check("ON: tooltip on hover", (await page.locator('div[role="status"]').count()) === 1);

    await page.getByRole("button", { name: "전체(거래량만)" }).click();
    await page.getByText("전체 면적은 서로 다른 면적").waitFor();
    check("ON: 'all' hides price chart", (await page.locator('svg[aria-label^="가격 추이"]').count()) === 0);
    check("ON: 'all' shows no median price", (await page.locator("text=중위 거래가").locator("..").getByText("-", { exact: true }).count()) === 1);
    check("ON: 'all' requests no points or evidence", !v2.list.some((p) => /\/(points|transactions)\?.*areaType=all/.test(p)));
    if (shots) await page.screenshot({ path: `${shots}/p2-all.png`, fullPage: true });

    await page.getByRole("tab", { name: /매매/ }).click();
    check("ON: back to sale list", (await page.getByText(/거래를 불러오는 중|건 ·/).count()) > 0);
    check("ON: no page errors", errors.length === 0, errors.join(" | "));
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

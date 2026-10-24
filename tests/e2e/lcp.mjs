// Measures LCP of the production build at phone size with CPU 4x slowdown and "Slow 4G"-like network.
// Requires: npm run build, API on :3001. Serves dist with `vite preview` (proxying /api).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const preview = spawn("npx", ["vite", "preview", "--port", "4179", "--strictPort"], { stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-preview.pid); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 60; i++) { try { await fetch("http://localhost:4179/"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const browser = await chromium.launch();
const runs = [];
for (let i = 0; i < 5; i++) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto("http://localhost:4179/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  runs.push(await page.evaluate(() => window.__lcp));
  await page.close();
}
await browser.close();
stop();
runs.sort((a, b) => a - b);
console.log(JSON.stringify({ lcp_ms_runs: runs.map((r) => Math.round(r)), median: Math.round(runs[2]), target_p75: 2500, conditions: "390x780, CPU 4x, 150ms RTT, 1.6Mbps down, vite preview (no CDN, no compression)" }));
process.exit(runs[3] <= 2500 ? 0 : 1);

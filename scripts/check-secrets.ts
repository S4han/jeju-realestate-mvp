// Scans places a secret could leak to, without ever printing secret values (AT-018, SECURITY_COST.md):
//   1. built browser bundle (dist/)   2. tracked files   3. full git history
//   4. sync_jobs error messages in the database (when DATABASE_URL is set)
// Looks for the actual values of DATA_GO_KR_SERVICE_KEY / DB password / CRON_SECRET and for
// generic patterns (serviceKey=<long value>, postgres URLs with passwords).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Finding = { where: string; what: string };
const findings: Finding[] = [];

const secrets: { name: string; value: string }[] = [];
const add = (name: string, value: string | undefined) => {
  if (value && value.length >= 8) secrets.push({ name, value }, { name: `${name} (url-encoded)`, value: encodeURIComponent(value) });
};
add("DATA_GO_KR_SERVICE_KEY", process.env.DATA_GO_KR_SERVICE_KEY);
add("CRON_SECRET", process.env.CRON_SECRET);
try {
  const u = new URL(process.env.DATABASE_URL ?? "");
  add("DATABASE password", decodeURIComponent(u.password));
} catch {}

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "serviceKey with a long value", re: /serviceKey=(?!\*\*\*|서비스키|\$\{|"\s*\+)[A-Za-z0-9%+/=]{30,}/ },
  { name: "postgres URL with inline password", re: /postgres(?:ql)?:\/\/[^:\s/]+:(?!PASSWORD@|\*\*\*@|y@|SECRETPW@|hunter2@|jeju_local_dev@)[^@\s]{6,}@/ },
];

function scanText(where: string, text: string) {
  for (const s of secrets) if (s.value.length >= 8 && text.includes(s.value)) findings.push({ where, what: `value of ${s.name}` });
  for (const p of PATTERNS) if (p.re.test(text)) findings.push({ where, what: p.name });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 1. bundle
if (existsSync("dist")) for (const f of walk("dist")) scanText(f, readFileSync(f, "latin1"));
else findings.push({ where: "dist/", what: "missing: run npm run build first" });

// 2. tracked files (binary fixtures included; harmless)
for (const f of execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  if (existsSync(f)) scanText(f, readFileSync(f, "latin1"));
}

// 3. history (all commits, all branches)
scanText("git history", execFileSync("git", ["log", "-p", "--all", "--no-color"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }));

// 4. database logs
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query("SELECT coalesce(string_agg(coalesce(error_message,''), '\n'), '') AS t FROM sync_jobs");
    scanText("sync_jobs.error_message", rows[0].t);
  } finally {
    await pool.end();
  }
}

const checked = secrets.filter((s) => !s.name.endsWith("(url-encoded)")).map((s) => s.name);
console.log(`checked secret values: ${checked.join(", ") || "(none set)"}; patterns: ${PATTERNS.length}`);
if (findings.length) {
  for (const f of findings) console.error(`LEAK? ${f.where}: ${f.what}`);
  process.exit(1);
}
console.log("ok: no secret values or secret-shaped strings found in dist/, tracked files, git history, sync_jobs");

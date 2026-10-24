// Fails if browser code references env vars outside the public allowlist.
// Vite inlines import.meta.env.VITE_* into the bundle, so only public identifiers may be used there.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_ENV_ALLOWLIST = new Set(["VITE_KAKAO_MAP_JS_KEY", "MODE", "DEV", "PROD", "BASE_URL", "SSR"]);

export async function findEnvExposure(dir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(tsx?|jsx?)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    if (/process\.env/.test(text)) problems.push(`${file}: process.env is not allowed in browser code`);
    for (const m of text.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
      if (!PUBLIC_ENV_ALLOWLIST.has(m[1]!)) problems.push(`${file}: import.meta.env.${m[1]} is not in the public allowlist`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await findEnvExposure(path.resolve("src"));
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("ok: no non-public env references in src/");
}

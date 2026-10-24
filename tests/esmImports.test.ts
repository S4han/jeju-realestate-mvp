import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vercel compiles api/ and server/ file by file and runs them as native ESM ("type": "module"),
// so relative imports need an explicit .js extension or the function fails with ERR_MODULE_NOT_FOUND.
async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.filter((name) => name.endsWith(".ts")).map((name) => path.join(dir, name));
}

describe("serverless ESM imports", () => {
  it("api/ and server/ use explicit extensions on relative imports", async () => {
    const offenders: string[] = [];
    for (const file of [...(await tsFiles("api")), ...(await tsFiles("server"))]) {
      const source = await readFile(file, "utf8");
      for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const spec = m[1] ?? "";
        if (!/\.(js|json)$/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

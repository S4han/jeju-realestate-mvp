import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findEnvExposure } from "../scripts/check-env-exposure";

describe("browser env exposure check", () => {
  it("passes for the real src/ tree", async () => {
    expect(await findEnvExposure(path.resolve("src"))).toEqual([]);
  });

  it("flags non-allowlisted VITE_ vars and process.env", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "envcheck-"));
    await writeFile(path.join(dir, "a.ts"), "const k = import.meta.env.VITE_DATA_GO_KR_SERVICE_KEY;");
    await writeFile(path.join(dir, "b.tsx"), "const d = process.env.DATABASE_URL;");
    await writeFile(path.join(dir, "ok.ts"), "const m = import.meta.env.VITE_KAKAO_MAP_JS_KEY;");
    const problems = await findEnvExposure(dir);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/VITE_DATA_GO_KR_SERVICE_KEY/);
    expect(problems.join("\n")).toMatch(/process\.env/);
  });
});

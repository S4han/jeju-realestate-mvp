import { describe, expect, it } from "vitest";
import { ConfigError, loadServerConfig, redact } from "../server/config";

describe("loadServerConfig", () => {
  it("accepts a valid environment and applies defaults", () => {
    const c = loadServerConfig({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(c.DATABASE_SSL).toBe("disable");
    expect(c.API_PORT).toBe(3001);
  });

  it("names the bad variable without echoing its value", () => {
    const secret = "mysql://user:TOPSECRET@host/db";
    let err: unknown;
    try {
      loadServerConfig({ DATABASE_URL: secret });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain("DATABASE_URL");
    expect((err as Error).message).not.toContain("TOPSECRET");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadServerConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe("redact", () => {
  it("masks serviceKey query values, URL passwords and known secret env values", () => {
    const env = { DATA_GO_KR_SERVICE_KEY: "abcDEF123+/==", DATABASE_URL: "postgres://u:pw@h/db" };
    const text =
      "GET https://apis.data.go.kr/x?serviceKey=abc%2B123&LAWD_CD=50110 key=abcDEF123+/== db=postgres://admin:hunter2@db.example:5432/x";
    const out = redact(text, env);
    expect(out).toContain("serviceKey=***&LAWD_CD=50110");
    expect(out).not.toContain("abcDEF123+/==");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("postgres://admin:***@db.example");
  });
});

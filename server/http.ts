import type { IncomingMessage, ServerResponse } from "node:http";

export type ApiRequest = IncomingMessage & { query?: Record<string, string | string[] | undefined> };
export type ApiResponse = ServerResponse;

export type HandlerResult = { status: number; body: unknown; cacheSeconds?: number };

export function sendJson(res: ApiResponse, result: HandlerResult): void {
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Cache-Control",
    result.status === 200 && result.cacheSeconds ? `public, s-maxage=${result.cacheSeconds}` : "no-store",
  );
  res.end(JSON.stringify(result.body));
}

// Generic error body: no stack traces, SQL or connection details leave the server.
export function serviceUnavailable(code: string): HandlerResult {
  return { status: 503, body: { error: { code, message: "데이터를 일시적으로 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." } } };
}

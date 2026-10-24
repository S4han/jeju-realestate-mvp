// MOLIT apartment transaction APIs (data.go.kr). Endpoints, parameters and paging limits
// were verified with live calls in TASK-001 (docs/API_VERIFICATION.md).
import { XMLParser } from "fast-xml-parser";

export type SourceId = "MOLIT_SALE" | "MOLIT_RENT";

export const SOURCES: Record<SourceId, { url: string; pageSize: number }> = {
  // Detailed sale API: same rows as the basic one plus aptSeq / PNU parts / road address.
  MOLIT_SALE: { url: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev", pageSize: 1000 },
  // Rent API resets the connection at numOfRows=1000; 400 works.
  MOLIT_RENT: { url: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent", pageSize: 400 },
};

export type RawItem = Record<string, string>;

export class SourceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const parser = new XMLParser({ parseTagValue: false, trimValues: true, isArray: (name) => name === "item" });

// Accepts the normal <response> envelope and the gateway's <OpenAPI_ServiceResponse> error envelope.
export function parseMolitXml(xml: string): { items: RawItem[]; totalCount: number } {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new SourceError("BAD_RESPONSE", "response is not valid XML");
  }
  const gatewayError = doc?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gatewayError) {
    throw new SourceError(`GATEWAY_${gatewayError.returnReasonCode ?? "UNKNOWN"}`, String(gatewayError.returnAuthMsg ?? gatewayError.errMsg ?? "gateway error"));
  }
  const header = doc?.response?.header;
  const body = doc?.response?.body;
  if (!header || header.resultCode === undefined) throw new SourceError("BAD_RESPONSE", "missing response header");
  if (header.resultCode !== "000") throw new SourceError(`RESULT_${header.resultCode}`, String(header.resultMsg ?? ""));
  const totalCount = Number(body?.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) throw new SourceError("BAD_RESPONSE", "missing totalCount");
  const rawItems: unknown[] = body?.items?.item ?? [];
  const items = rawItems.map((it) => {
    const out: RawItem = {};
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) out[k] = v == null ? "" : String(v).trim();
    return out;
  });
  return { items, totalCount };
}

export type Fetcher = (url: string) => Promise<{ status: number; text: string }>;

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: await res.text() };
};

export type FetchMonthOptions = {
  source: SourceId;
  lawdCd: string;
  dealYmd: string;
  serviceKey: string;
  fetcher?: Fetcher;
  // Called before every HTTP request (including retries); throws to stop (e.g. budget exhausted).
  beforeCall: () => Promise<void>;
  retryDelaysMs?: number[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetches every page of one (source, region, month). Throws SourceError unless the full set was received.
export async function fetchMonth(o: FetchMonthOptions): Promise<{ items: RawItem[]; totalCount: number; calls: number }> {
  const { url, pageSize } = SOURCES[o.source];
  const fetcher = o.fetcher ?? defaultFetcher;
  const delays = o.retryDelaysMs ?? [2_000, 5_000];
  let calls = 0;
  const items: RawItem[] = [];
  let totalCount = 0;
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ LAWD_CD: o.lawdCd, DEAL_YMD: o.dealYmd, numOfRows: String(pageSize), pageNo: String(page) });
    const requestUrl = `${url}?serviceKey=${encodeURIComponent(o.serviceKey)}&${qs}`;
    let parsed: { items: RawItem[]; totalCount: number } | undefined;
    for (let attempt = 0; ; attempt++) {
      await o.beforeCall();
      calls++;
      try {
        const res = await fetcher(requestUrl);
        if (res.status >= 500) throw new SourceError(`HTTP_${res.status}`, "server error");
        if (res.status !== 200) throw new SourceError(`HTTP_${res.status}`, "unexpected status");
        parsed = parseMolitXml(res.text);
        break;
      } catch (err) {
        // Connection resets/timeouts and 5xx are retried; result codes and bad requests are not.
        const retryable = !(err instanceof SourceError) || err.code.startsWith("HTTP_5");
        if (!retryable || attempt >= delays.length) {
          if (err instanceof SourceError) throw err;
          throw new SourceError("NETWORK", (err as Error).name || "network error");
        }
        await sleep(delays[attempt]!);
      }
    }
    totalCount = parsed.totalCount;
    items.push(...parsed.items);
    // A short page means the source has nothing more, whatever totalCount says.
    if (items.length >= totalCount || parsed.items.length < pageSize) break;
  }
  if (items.length !== totalCount) {
    throw new SourceError("COUNT_MISMATCH", `received ${items.length} of ${totalCount}`);
  }
  return { items, totalCount, calls };
}

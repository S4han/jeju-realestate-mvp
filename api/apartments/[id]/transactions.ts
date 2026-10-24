import { getPool } from "../../../server/db";
import { listTransactions } from "../../../server/handlers/transactions";
import { sendJson, type ApiRequest, type ApiResponse } from "../../../server/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const { id, ...query } = req.query ?? {};
  sendJson(res, await listTransactions(getPool(), Array.isArray(id) ? id[0] : id, query));
}

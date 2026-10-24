import { getPool } from "../../../server/db.js";
import { listTransactions } from "../../../server/handlers/transactions.js";
import { sendJson, type ApiRequest, type ApiResponse } from "../../../server/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const { id, ...query } = req.query ?? {};
  sendJson(res, await listTransactions(getPool(), Array.isArray(id) ? id[0] : id, query));
}

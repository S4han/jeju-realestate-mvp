import { getPool } from "../../server/db.js";
import { getTransaction } from "../../server/handlers/transactions.js";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const id = req.query?.id;
  sendJson(res, await getTransaction(getPool(), Array.isArray(id) ? id[0] : id));
}

import { getPool } from "../../server/db";
import { getTransaction } from "../../server/handlers/transactions";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const id = req.query?.id;
  sendJson(res, await getTransaction(getPool(), Array.isArray(id) ? id[0] : id));
}

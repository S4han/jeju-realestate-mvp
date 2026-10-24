import { listTransactions } from "../../../server/handlers/transactions.js";
import type { ApiRequest, ApiResponse } from "../../../server/http.js";
import { respondWithPool } from "../../../server/withPool.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const { id, ...query } = req.query ?? {};
  await respondWithPool(res, (pool) => listTransactions(pool, Array.isArray(id) ? id[0] : id, query));
}

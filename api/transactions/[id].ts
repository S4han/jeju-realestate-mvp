import { getTransaction } from "../../server/handlers/transactions.js";
import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { respondWithPool } from "../../server/withPool.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const id = req.query?.id;
  await respondWithPool(res, (pool) => getTransaction(pool, Array.isArray(id) ? id[0] : id));
}

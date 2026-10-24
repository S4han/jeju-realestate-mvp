import { getDataStatus } from "../../server/handlers/dataStatus.js";
import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { respondWithPool } from "../../server/withPool.js";

export default async function handler(_req: ApiRequest, res: ApiResponse): Promise<void> {
  await respondWithPool(res, (pool) => getDataStatus(pool));
}

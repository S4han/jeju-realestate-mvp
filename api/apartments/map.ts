import { mapApartments } from "../../server/handlers/apartments.js";
import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { respondWithPool } from "../../server/withPool.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await respondWithPool(res, (pool) => mapApartments(pool, req.query ?? {}));
}

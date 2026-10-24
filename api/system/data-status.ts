import { getPool } from "../../server/db.js";
import { getDataStatus } from "../../server/handlers/dataStatus.js";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http.js";

export default async function handler(_req: ApiRequest, res: ApiResponse): Promise<void> {
  sendJson(res, await getDataStatus(getPool()));
}

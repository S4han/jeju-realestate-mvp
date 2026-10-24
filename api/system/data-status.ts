import { getPool } from "../../server/db";
import { getDataStatus } from "../../server/handlers/dataStatus";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http";

export default async function handler(_req: ApiRequest, res: ApiResponse): Promise<void> {
  sendJson(res, await getDataStatus(getPool()));
}

import { getPool } from "../../server/db";
import { mapApartments } from "../../server/handlers/apartments";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  sendJson(res, await mapApartments(getPool(), req.query ?? {}));
}

import { getPool } from "../../server/db.js";
import { mapApartments } from "../../server/handlers/apartments.js";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  sendJson(res, await mapApartments(getPool(), req.query ?? {}));
}

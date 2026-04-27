import { Response, Request } from "express";
import apiService, { getCloudQs } from "../../libs/cloud.api";
import { parseIntId } from "../../libs/query";

export async function getLabelUpdatesController(req: Request, res: Response) {
  const qs = getCloudQs(req);
  const result = await apiService.get(`/device/item-sheet/label-update?${qs}`);
  res.status(200).json(result);
}

export async function getLabelUpdateByIdController(
  req: Request,
  res: Response,
) {
  const id = parseIntId(req, "id");
  const result = await apiService.get(`/device/item-sheet/label-update/${id}`);
  res.status(200).json(result);
}

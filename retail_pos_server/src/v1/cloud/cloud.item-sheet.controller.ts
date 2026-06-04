import { Response, Request } from "express";
import apiService, { getCloudQs } from "../../libs/cloud.api";
import { parseIntId } from "../../libs/query";
import {
  getPrintedLabelUpdateSheetIdsService,
  markLabelUpdateSheetPrintedService,
} from "./cloud.item-sheet.printed.service";

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

export async function getPrintedLabelUpdateSheetIdsController(
  _req: Request,
  res: Response,
) {
  const result = await getPrintedLabelUpdateSheetIdsService();
  res.status(200).json(result);
}

export async function markLabelUpdateSheetPrintedController(
  req: Request,
  res: Response,
) {
  const id = parseIntId(req, "id");
  const user = res.locals.user
    ? { id: res.locals.user.id, name: res.locals.user.name }
    : undefined;
  const result = await markLabelUpdateSheetPrintedService(id, user);
  res.status(200).json(result);
}

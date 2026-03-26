import { Request, Response } from "express";
import { parseIntId, parseFindManyQuery } from "../../libs/query";
import {
  getAvailablePromotionsService,
  searchPromotionsService,
  getPromotionByIdService,
} from "./promotion.service";

export async function getAvailablePromotionsController(
  req: Request,
  res: Response,
) {
  const result = await getAvailablePromotionsService();
  res.status(200).json(result);
}

export async function searchPromotionsController(
  req: Request,
  res: Response,
) {
  const query = parseFindManyQuery(req);
  const result = await searchPromotionsService(query);
  res.status(200).json(result);
}

export async function getPromotionByIdController(
  req: Request,
  res: Response,
) {
  const id = parseIntId(req);
  const result = await getPromotionByIdService(id);
  res.status(200).json(result);
}

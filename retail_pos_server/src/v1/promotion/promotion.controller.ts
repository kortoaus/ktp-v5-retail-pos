import { Request, Response } from "express";
import { getAvailablePromotionsService } from "./promotion.service";

export async function getAvailablePromotionsController(
  req: Request,
  res: Response,
) {
  const result = await getAvailablePromotionsService();
  res.status(200).json(result);
}

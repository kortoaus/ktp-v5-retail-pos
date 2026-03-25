import { Request, Response } from "express";
import { searchBrandByIdService, searchBrandsService } from "./brand.service";
import { parseFindManyQuery, parseIntId } from "../../libs/query";

export async function searchBrandsController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await searchBrandsService(query);
  res.status(200).json(result);
}

export async function searchBrandByIdController(req: Request, res: Response) {
  const result = await searchBrandByIdService(parseIntId(req, "id"));
  res.status(200).json(result);
}

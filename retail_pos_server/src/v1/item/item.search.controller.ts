import { Request, Response } from "express";
import { parseFindManyQuery, parseIntId } from "../../libs/query";
import {
  searchItemByIdService,
  searchItemsService,
} from "./item.search.service";
import { getItemByBarcode } from "./item.search.barcode.service";

export async function searchItemsController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await searchItemsService(query);
  res.status(200).json(result);
}

export async function searchScaleItemsController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await searchItemsService(query, true);
  res.status(200).json(result);
}

export async function searchItemsBarcodeController(
  req: Request,
  res: Response,
) {
  const { barcode } = req.query;
  if (!barcode || typeof barcode !== "string") {
    res.status(400).json({
      ok: false,
      msg: "Barcode is required",
      result: null,
    });
    return;
  }
  const result = await getItemByBarcode(barcode);
  res.status(200).json(result);
}

export async function searchItemByIdController(req: Request, res: Response) {
  const id = parseIntId(req, "id");
  const result = await searchItemByIdService(id);
  res.status(200).json(result);
}

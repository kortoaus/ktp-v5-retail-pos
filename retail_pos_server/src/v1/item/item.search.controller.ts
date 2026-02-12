import { Request, Response } from "express";
import { parseFindManyQuery } from "../../libs/query";
import { searchItemsService } from "./item.search.service";
import { getItemByBarcode } from "./item.search.barcode.service";

export async function searchItemsController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await searchItemsService(query);
  res.status(200).json(result);
}

export async function searchItemsBarcodeController(
  req: Request,
  res: Response,
) {
  const { barcode } = req.query;
  console.log(barcode);
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

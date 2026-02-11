import { Response, Request } from "express";
import {
  cloudBrandMigrateService,
  cloudCategoryMigrateService,
  cloudItemMigrateService,
  cloudPriceMigrateService,
  cloudPromoPriceMigrateService,
  normalizeBarcodesService,
} from "./cloud.migrate.service";

export async function cloudItemMigrateController(req: Request, res: Response) {
  const categoryResult = await cloudCategoryMigrateService();

  if (!categoryResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate categories",
    });
    return;
  }

  const brandResult = await cloudBrandMigrateService();
  if (!brandResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate brands",
    });
    return;
  }

  const itemResult = await cloudItemMigrateService();
  if (!itemResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate items",
    });
    return;
  }

  const priceResult = await cloudPriceMigrateService();
  if (!priceResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate prices",
    });
    return;
  }

  const promoPriceResult = await cloudPromoPriceMigrateService();
  if (!promoPriceResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate promo prices",
    });
    return;
  }
  const normalizeBarcodesResult = await normalizeBarcodesService();
  if (!normalizeBarcodesResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to normalize barcodes",
    });
    return;
  }
  res.status(200).json({
    ok: true,
    msg: "Migrated all data from cloud",
  });
}

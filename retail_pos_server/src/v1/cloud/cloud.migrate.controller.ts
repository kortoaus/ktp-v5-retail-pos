import { Response, Request } from "express";
import {
  cloudBrandMigrateService,
  cloudCompanyMigrateService,
  cloudHotkeyMigrateService,
  cloudItemMigrateService,
  cloudPriceMigrateService,
  cloudPromoPriceMigrateService,
  normalizeBarcodesService,
} from "./cloud.migrate.service";

import { getIO } from "../../libs/socket";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "./cloud.sync.service";
import { triggerSyncPendingOrderCollects } from "../order/order.collect.service";

export async function cloudItemMigrateController(req: Request, res: Response) {
  const companyResult = await cloudCompanyMigrateService();
  if (!companyResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate company data",
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

  const cloudHotkeyResult = await cloudHotkeyMigrateService();
  if (!cloudHotkeyResult) {
    res.status(500).json({
      ok: false,
      msg: "Failed to migrate hotkeys",
    });
    return;
  }

  triggerSyncAllSaleInvoices();
  triggerSyncAllShifts();
  // S3 — 미확인 주문 collect 도 같은 트리거에서 스윕.
  triggerSyncPendingOrderCollects();

  res.status(200).json({
    ok: true,
    msg: "Migrated all data from cloud",
  });

  getIO().emit("cloud-sync-completed");
}

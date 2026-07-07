import { Request, Response } from "express";
import { parseIntId } from "../../libs/query";
import {
  getCachedPickupOrderByCrmId,
  listCachedPickupOrders,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";
import { pickupOrderSyncService } from "./pickup-order.sync.service";

export async function listPickupOrdersController(req: Request, res: Response) {
  const query = parsePickupOrderListQuery(req.query as Record<string, unknown>);
  const result = await listCachedPickupOrders(query);
  res.status(200).json(result);
}

export async function getPickupOrderByIdController(req: Request, res: Response) {
  const crmOrderId = parseIntId(req, "id");
  const result = await getCachedPickupOrderByCrmId(crmOrderId);
  res.status(200).json(result);
}

export async function syncPickupOrdersController(_req: Request, res: Response) {
  const result = await pickupOrderSyncService.syncPickupOrders();
  res.status(200).json({
    ok: true,
    msg: "Pickup order sync completed",
    result,
    paging: null,
  });
}

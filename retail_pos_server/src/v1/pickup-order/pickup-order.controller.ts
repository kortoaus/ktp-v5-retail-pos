import { Request, Response } from "express";
import { HttpException } from "../../libs/exceptions";
import { parseIntId } from "../../libs/query";
import type { UserModel } from "../../generated/prisma/models";
import {
  getCachedPickupOrderByCrmId,
  listCachedPickupOrders,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";
import {
  getPickupOrderMemberPhoneByCrmOrderId,
} from "./pickup-order.member-phone";
import { updatePickupOrderStatusFromPos } from "./pickup-order.status";
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

export async function getPickupOrderMemberPhoneController(
  req: Request,
  res: Response,
) {
  try {
    const crmOrderId = parseIntId(req, "id");
    const result = await getPickupOrderMemberPhoneByCrmOrderId(crmOrderId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpException) {
      res.status(error.statusCode).json({
        ok: false,
        msg: error.message,
        result: null,
        paging: null,
      });
      return;
    }

    console.error("getPickupOrderMemberPhoneController failed");
    res.status(500).json({
      ok: false,
      msg: "Internal server error",
      result: null,
      paging: null,
    });
  }
}

export async function updatePickupOrderStatusController(
  req: Request,
  res: Response,
) {
  const crmOrderId = parseIntId(req, "id");
  const user = res.locals.user as UserModel;
  const result = await updatePickupOrderStatusFromPos({
    orderId: crmOrderId,
    body: req.body,
    user: { id: user.id, name: user.name, scope: user.scope },
  });

  res.status(200).json({
    ok: true,
    msg: "Pickup order status updated",
    result,
    paging: null,
  });
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

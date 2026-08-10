import { Request, Response } from "express";
import { getCloudQs } from "../../libs/cloud.api";
import { getOrdersService } from "./order.service";

// GET /api/order — crm /device/order 실시간 프록시 (로컬 미러 금지, §X-4).
// preset/fulfillment/page/limit 쿼리는 그대로 통과, 검증은 crm 이 담당(400).
export async function getOrdersController(req: Request, res: Response) {
  const qs = getCloudQs(req);
  res.status(200).json(await getOrdersService(qs));
}

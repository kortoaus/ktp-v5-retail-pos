import { Request, Response } from "express";
import { UserModel } from "../../generated/prisma/models";
import { getCloudQs } from "../../libs/cloud.api";
import {
  BadRequestException,
  UnauthorizedException,
} from "../../libs/exceptions";
import {
  acceptOrderService,
  getOrderDetailService,
  getOrdersService,
  pickingOrderService,
  printedOrderService,
  readyOrderService,
  rejectOrderService,
  revealOrderMemberPhoneService,
} from "./order.service";

// GET /api/order — crm /device/order 실시간 프록시 (로컬 미러 금지, §X-4).
// preset/fulfillment/page/limit 쿼리는 그대로 통과, 검증은 crm 이 담당(400).
export async function getOrdersController(req: Request, res: Response) {
  const qs = getCloudQs(req);
  res.status(200).json(await getOrdersService(qs));
}

function parseOrderId(raw: unknown): number {
  const id = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException("Invalid order id");
  }
  return id;
}

// GET /api/order/:id — 상세 프록시 (슬라이스 B).
export async function getOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await getOrderDetailService(id));
}

// POST /api/order/:id/accept|ready|reject — 전이 프록시, body 패스스루.
// version/reason 검증은 crm(400), 충돌은 crm 409 TRANSITION_CONFLICT.
export async function acceptOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await acceptOrderService(id, req.body));
}

export async function readyOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await readyOrderService(id, req.body));
}

export async function rejectOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await rejectOrderService(id, req.body));
}

// pickerName 정규화 — 로컬 유저 이름은 무검증 저장이므로 crm 계약(trim 후
// 1..50자)에 여기서 맞춘다. 빈 이름은 crm 으로 전달하지 않고 로컬에서
// 명확한 메시지로 실패시킨다.
export function resolvePickerName(user: Pick<UserModel, "name">): string {
  const pickerName = user.name.trim().slice(0, 50);
  if (pickerName.length === 0) {
    throw new UnauthorizedException("Staff user has no display name");
  }
  return pickerName;
}

// POST /api/order/:id/picking — 러너 피킹 확정 프록시(S2); 계약 상세는 order.service.ts.
export async function pickingOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  const user = res.locals.user as UserModel;
  res
    .status(200)
    .json(await pickingOrderService(id, req.body, resolvePickerName(user)));
}

// POST /api/order/:id/printed — 인쇄 기록 프록시(슬라이스 C), body 패스스루.
// kind/lineId 검증은 crm(400). 전이가 아니므로 version 없음.
export async function printedOrderController(req: Request, res: Response) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await printedOrderService(id, req.body));
}

export async function revealOrderMemberPhoneController(
  req: Request,
  res: Response,
) {
  const id = parseOrderId(req.params.id);
  res.status(200).json(await revealOrderMemberPhoneService(id));
}


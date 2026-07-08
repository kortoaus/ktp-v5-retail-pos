import db from "../../libs/db";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import { updateCrmPickupOrderStatus } from "./pickup-order.crm";
import { upsertPickupOrderPage } from "./pickup-order.repository";
import {
  assertPickupOrderStatusManagerAllowed,
  assertPickupOrderStatusTransitionAllowed,
} from "./pickup-order.status-policy";
import type { CrmPickupOrderWire, PickupOrderStatus } from "./pickup-order.types";

export const POS_PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
] as const satisfies readonly PickupOrderStatus[];

export type PosPickupOrderStatus = (typeof POS_PICKUP_ORDER_STATUSES)[number];

export type PickupOrderStatusBody = {
  status: PosPickupOrderStatus;
};

type PosUserSnapshot = {
  id: number;
  name: string;
  scope: string[];
};

type Deps = {
  updateCrmStatus?: typeof updateCrmPickupOrderStatus;
  upsertLocalPickupOrder?: (items: CrmPickupOrderWire[]) => Promise<unknown>;
  getLocalPickupOrderStatus?: (orderId: number) => Promise<PickupOrderStatus>;
  getLocalPickupOrder?: (orderId: number) => Promise<CrmPickupOrderWire>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePickupOrderStatusBody(body: unknown): PickupOrderStatusBody {
  if (!isRecord(body)) {
    throw new BadRequestException("Pickup order status body is required");
  }
  if (
    typeof body.status !== "string" ||
    !POS_PICKUP_ORDER_STATUSES.includes(body.status as PosPickupOrderStatus)
  ) {
    throw new BadRequestException("status must be a POS pickup order status");
  }
  return { status: body.status as PosPickupOrderStatus };
}

async function getCachedPickupOrderStatus(
  orderId: number,
): Promise<PickupOrderStatus> {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId: orderId },
    select: { status: true },
  });
  if (!row) {
    throw new NotFoundException("Pickup order not found");
  }
  return row.status as PickupOrderStatus;
}

async function getCachedPickupOrderWire(
  orderId: number,
): Promise<CrmPickupOrderWire> {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId: orderId },
    include: { lines: { orderBy: { index: "asc" } } },
  });
  if (!row) {
    throw new NotFoundException("Pickup order not found");
  }

  return {
    id: row.crmOrderId,
    companyId: row.companyId,
    documentId: row.documentId,
    status: row.status as PickupOrderStatus,
    memberId: row.memberId,
    memberName: row.memberName,
    memberLevel: row.memberLevel,
    memberPhoneLast4: row.memberPhoneLast4,
    pickupStartsAt: row.pickupStartsAt.toISOString(),
    linesTotal: row.linesTotal,
    total: row.total,
    createdAt: row.crmCreatedAt.toISOString(),
    updatedAt: row.crmUpdatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.crmLineId,
      orderId: line.crmOrderId,
      index: line.index,
      itemId: line.itemId,
      name_en: line.name_en,
      name_ko: line.name_ko,
      barcode: line.barcode,
      code: line.code,
      uom: line.uom,
      prices: line.prices,
      promoPrices: line.promoPrices,
      memberLevel: line.memberLevel,
      optionTotal: line.optionTotal,
      qty: line.qty,
      total: line.total,
      note: line.note,
      selectedOptionsSnapshot: line.selectedOptionsSnapshot,
      createdAt: line.crmCreatedAt.toISOString(),
      updatedAt: line.crmUpdatedAt.toISOString(),
    })),
  };
}

export async function updatePickupOrderStatusFromPos(
  input: {
    orderId: number;
    body: unknown;
    user: PosUserSnapshot;
  },
  deps: Deps = {},
) {
  const parsed = parsePickupOrderStatusBody(input.body);
  const updateCrmStatus = deps.updateCrmStatus ?? updateCrmPickupOrderStatus;
  const upsertLocalPickupOrder =
    deps.upsertLocalPickupOrder ?? upsertPickupOrderPage;
  const getLocalPickupOrderStatus =
    deps.getLocalPickupOrderStatus ?? getCachedPickupOrderStatus;
  const currentStatus = await getLocalPickupOrderStatus(input.orderId);
  assertPickupOrderStatusTransitionAllowed(currentStatus, parsed.status);
  assertPickupOrderStatusManagerAllowed(
    currentStatus,
    parsed.status,
    input.user.scope,
  );
  if (currentStatus === parsed.status) {
    const getLocalPickupOrder =
      deps.getLocalPickupOrder ?? getCachedPickupOrderWire;
    return getLocalPickupOrder(input.orderId);
  }

  const result = await updateCrmStatus(input.orderId, {
    status: parsed.status,
    actorId: String(input.user.id),
    actorName: input.user.name,
  });

  await upsertLocalPickupOrder([result]);

  return result;
}

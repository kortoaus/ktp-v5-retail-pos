import { BadRequestException } from "../../libs/exceptions";
import { updateCrmPickupOrderStatus } from "./pickup-order.crm";
import { upsertPickupOrderPage } from "./pickup-order.repository";
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
};

type Deps = {
  updateCrmStatus?: typeof updateCrmPickupOrderStatus;
  upsertLocalPickupOrder?: (items: CrmPickupOrderWire[]) => Promise<unknown>;
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

  const result = await updateCrmStatus(input.orderId, {
    status: parsed.status,
    actorId: String(input.user.id),
    actorName: input.user.name,
  });

  await upsertLocalPickupOrder([result]);

  return result;
}

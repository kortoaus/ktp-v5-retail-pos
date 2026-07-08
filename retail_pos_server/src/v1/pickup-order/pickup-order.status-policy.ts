import { BadRequestException, UnauthorizedException } from "../../libs/exceptions";
import type { PosPickupOrderStatus } from "./pickup-order.status";
import type { PickupOrderStatus } from "./pickup-order.types";

const allowedTransitions: Record<PickupOrderStatus, readonly PosPickupOrderStatus[]> = {
  PENDING: ["ORDER_CONFIRMED", "CANCELLED_BY_STORE"],
  ORDER_CONFIRMED: ["READY", "CANCELLED_BY_STORE"],
  READY: ["COMPLETED", "CANCELLED_BY_STORE"],
  COMPLETED: [],
  CANCELLED_BY_STORE: [],
  CANCELLED_BY_CUSTOMER: [],
};

export function canTransitionPickupOrderStatus(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

export function requiresManagerForPickupOrderStatusTransition(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return fromStatus === "READY" && toStatus === "CANCELLED_BY_STORE";
}

export function assertPickupOrderStatusTransitionAllowed(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): void {
  if (canTransitionPickupOrderStatus(fromStatus, toStatus)) return;
  throw new BadRequestException(
    `Cannot change pickup order from ${fromStatus} to ${toStatus}`,
  );
}

export function assertPickupOrderStatusManagerAllowed(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
  userScopes: readonly string[],
): void {
  if (!requiresManagerForPickupOrderStatusTransition(fromStatus, toStatus)) return;
  if (userScopes.includes("admin")) return;
  throw new UnauthorizedException("Manager permission required");
}

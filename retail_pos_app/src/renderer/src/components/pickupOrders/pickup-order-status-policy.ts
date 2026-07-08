import type {
  PickupOrderStatus,
  PosPickupOrderStatus,
} from "./pickup-order-types";

const allowedTransitions: Record<
  PickupOrderStatus,
  readonly PosPickupOrderStatus[]
> = {
  PENDING: ["ORDER_CONFIRMED", "CANCELLED_BY_STORE"],
  ORDER_CONFIRMED: ["READY", "CANCELLED_BY_STORE"],
  READY: ["COMPLETED", "CANCELLED_BY_STORE"],
  COMPLETED: [],
  CANCELLED_BY_STORE: [],
  CANCELLED_BY_CUSTOMER: [],
};

export function isPickupOrderLabelPrintable(
  status: PickupOrderStatus,
): boolean {
  return (
    status === "PENDING" ||
    status === "ORDER_CONFIRMED" ||
    status === "READY"
  );
}

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

export function canUserUsePickupOrderStatusAction(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
  userScopes: readonly string[],
): boolean {
  if (!canTransitionPickupOrderStatus(fromStatus, toStatus)) return false;
  if (!requiresManagerForPickupOrderStatusTransition(fromStatus, toStatus)) {
    return true;
  }
  return userScopes.includes("admin");
}

import type {
  OrderFulfillment,
  OrderStatus,
} from "../service/order.service";

export type OrderLoadQtySource = "ordered" | "picked";

export type OrderLoadPolicy =
  | { mode: "load"; qtySource: OrderLoadQtySource }
  | { mode: "confirm"; message: string; qtySource: OrderLoadQtySource }
  | { mode: "block"; message: string };

interface OrderLoadPolicyInput {
  status: OrderStatus;
  paymentStatus: "UNPAID" | "PAID";
  fulfillment: OrderFulfillment;
  pickedQtys: Array<number | null>;
}

const CANCELLED_ORDER_MESSAGE =
  "This online order can't be loaded — it's been cancelled.";

export function getOrderLoadPolicy({
  status,
  paymentStatus,
  fulfillment,
  pickedQtys,
}: OrderLoadPolicyInput): OrderLoadPolicy {
  if (paymentStatus === "PAID") {
    return {
      mode: "block",
      message: "This order was already paid online.",
    };
  }

  if (fulfillment === "DELIVERY") {
    return {
      mode: "block",
      message: "Delivery orders can't be loaded at the till.",
    };
  }

  switch (status) {
    case "COLLECTED":
      return {
        mode: "block",
        message: "This order has already been paid and collected.",
      };
    case "CANCELLED":
    case "REJECTED":
    case "EXPIRED":
      return { mode: "block", message: CANCELLED_ORDER_MESSAGE };
    case "PLACED":
      return {
        mode: "confirm",
        message:
          "This order hasn't been accepted yet. Load it anyway with the ordered quantities?",
        qtySource: "ordered",
      };
    case "ACCEPTED":
      return {
        mode: "confirm",
        message:
          "This order hasn't been picked yet. Load it with the ordered quantities?",
        qtySource: "ordered",
      };
    case "READY":
      if (pickedQtys.every((pickedQty) => pickedQty == null)) {
        return {
          mode: "confirm",
          message:
            "Picking wasn't recorded for this order. Load it with the ordered quantities?",
          qtySource: "ordered",
        };
      }
      return { mode: "load", qtySource: "picked" };
  }

}

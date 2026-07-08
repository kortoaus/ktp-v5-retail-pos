import type { PosPickupOrderStatus } from "../../components/pickupOrders/pickup-order-types";
import { updatePickupOrderStatus } from "../../service/pickup-order.service";

type PickupOrderLineMetadata = {
  pickupOrderId?: number | null;
};

export type PickupOrderCompletionFailure = {
  id: number;
  message: string;
};

type PickupOrderStatusUpdater = (
  id: number,
  status: PosPickupOrderStatus,
) => Promise<{ ok: boolean; msg?: string | null; result?: unknown }>;

function isFinitePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

export function getDistinctPickupOrderIds(
  lines: readonly PickupOrderLineMetadata[],
): number[] {
  return Array.from(
    new Set(
      lines
        .map((line) => line.pickupOrderId)
        .filter(isFinitePositiveInteger),
    ),
  );
}

export async function completePickupOrdersAfterSale(
  pickupOrderIds: readonly number[],
  updateStatus: PickupOrderStatusUpdater = updatePickupOrderStatus,
): Promise<PickupOrderCompletionFailure[]> {
  const failures: PickupOrderCompletionFailure[] = [];

  for (const id of pickupOrderIds) {
    try {
      const res = await updateStatus(id, "COMPLETED");
      if (!res.ok) {
        failures.push({ id, message: res.msg || "status update failed" });
      }
    } catch (error) {
      failures.push({
        id,
        message: error instanceof Error ? error.message : "status update failed",
      });
    }
  }

  return failures;
}

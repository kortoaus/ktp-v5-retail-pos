import type { Socket } from "socket.io";
import moment from "moment-timezone";
import { getIO } from "../../libs/socket";
import { countPendingPickupOrdersFrom } from "./pickup-order.repository";

export const PICKUP_PENDING_COUNT_EVENT = "pickup-order:pending-count";
export const PICKUP_PENDING_COUNT_INTERVAL_MS = 10_000;
const TIMEZONE = "Australia/Sydney";

export type PickupPendingCountPayload = {
  count: number;
  from: string;
  generatedAt: string;
  intervalMs: number;
};

type PickupPendingCountDeps = {
  now?: () => Date;
  countPendingPickupOrdersFrom?: (from: Date) => Promise<number>;
};

type EmitTarget = {
  emit: (
    event: typeof PICKUP_PENDING_COUNT_EVENT,
    payload: PickupPendingCountPayload,
  ) => boolean;
};

let intervalHandle: NodeJS.Timeout | null = null;
let intervalEmitRunning = false;

export function getPickupPendingCountFrom(now = new Date()): Date {
  return moment(now).tz(TIMEZONE).startOf("day").toDate();
}

export async function buildPickupPendingCountPayload(
  deps: PickupPendingCountDeps = {},
): Promise<PickupPendingCountPayload> {
  const now = deps.now?.() ?? new Date();
  const from = getPickupPendingCountFrom(now);
  const countFn =
    deps.countPendingPickupOrdersFrom ?? countPendingPickupOrdersFrom;
  const count = await countFn(from);

  return {
    count,
    from: from.toISOString(),
    generatedAt: now.toISOString(),
    intervalMs: PICKUP_PENDING_COUNT_INTERVAL_MS,
  };
}

async function emitPickupPendingCountToTarget(
  target: EmitTarget,
  deps: PickupPendingCountDeps = {},
): Promise<void> {
  const payload = await buildPickupPendingCountPayload(deps);
  target.emit(PICKUP_PENDING_COUNT_EVENT, payload);
}

export async function emitPickupPendingCount(
  deps: PickupPendingCountDeps = {},
): Promise<void> {
  try {
    await emitPickupPendingCountToTarget(getIO(), deps);
  } catch (error) {
    console.error("[pickup-order.pending-count] emit failed:", error);
  }
}

export async function emitPickupPendingCountToSocket(
  socket: Socket,
  deps: PickupPendingCountDeps = {},
): Promise<void> {
  try {
    await emitPickupPendingCountToTarget(socket, deps);
  } catch (error) {
    console.error(
      `[pickup-order.pending-count] socket emit failed (${socket.id}):`,
      error,
    );
  }
}

export function startPickupPendingCountBroadcaster(): void {
  if (intervalHandle) return;

  const run = () => {
    if (intervalEmitRunning) return;
    intervalEmitRunning = true;
    emitPickupPendingCount().finally(() => {
      intervalEmitRunning = false;
    });
  };

  run();
  intervalHandle = setInterval(run, PICKUP_PENDING_COUNT_INTERVAL_MS);
}

export function stopPickupPendingCountBroadcasterForTest(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  intervalEmitRunning = false;
}

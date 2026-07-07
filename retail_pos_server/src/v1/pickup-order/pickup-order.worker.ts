import { triggerSyncPickupOrders } from "./pickup-order.sync.service";

const PICKUP_ORDER_SYNC_INTERVAL_MS = 60_000;

let interval: NodeJS.Timeout | null = null;

export function shouldStartPickupOrderWorker(env = process.env): boolean {
  return env.CRON_INSTANCE === "true";
}

export function startPickupOrderSyncWorker(env = process.env) {
  if (!shouldStartPickupOrderWorker(env)) {
    console.log("[pickup-order.worker] disabled: CRON_INSTANCE is not true");
    return { started: false };
  }

  if (interval) {
    return { started: true };
  }

  console.log("[pickup-order.worker] starting 60s pickup order sync");
  triggerSyncPickupOrders();
  interval = setInterval(() => {
    triggerSyncPickupOrders();
  }, PICKUP_ORDER_SYNC_INTERVAL_MS);

  return { started: true };
}

export function stopPickupOrderSyncWorkerForTest() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

import { getIO } from "../../libs/socket";
import { fetchCrmPickupOrderSyncPage } from "./pickup-order.crm";
import { emitPickupPendingCount } from "./pickup-order.pending-count";
import {
  findExistingPickupOrderIds,
  getPickupOrderSyncState,
  markPickupOrderSyncFailure,
  markPickupOrderSyncSuccess,
  upsertPickupOrderPage,
} from "./pickup-order.repository";
import type {
  CrmPickupOrderWire,
  PickupOrderSyncOutcome,
  PickupOrderSyncPage,
} from "./pickup-order.types";

const SYNC_LIMIT = 200;
const CURSOR_OVERLAP_MS = 5000;

type SyncStateSnapshot = {
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
};

type PickupOrderSyncDependencies = {
  fetchPage(input: {
    updatedAfter?: Date;
    afterId?: number;
    limit: number;
  }): Promise<PickupOrderSyncPage>;
  getState(): Promise<SyncStateSnapshot>;
  findExistingIds(ids: number[]): Promise<Set<number>>;
  upsertPage(items: CrmPickupOrderWire[]): Promise<void>;
  markSuccess(input: {
    cursorUpdatedAt: Date | null;
    cursorOrderId: number | null;
  }): Promise<unknown>;
  markFailure(error: unknown): Promise<unknown>;
  emitNewOrders(payload: {
    count: number;
    orderIds: number[];
    latestPickupStartsAt: string | null;
  }): void;
};

export function subtractCursorOverlap(value: Date): Date {
  return new Date(Math.max(0, value.getTime() - CURSOR_OVERLAP_MS));
}

function latestPickupStartsAt(items: CrmPickupOrderWire[]): string | null {
  const startsAt = items.map((item) => item.pickupStartsAt).sort();
  return startsAt[startsAt.length - 1] ?? null;
}

function defaultEmitNewOrders(payload: {
  count: number;
  orderIds: number[];
  latestPickupStartsAt: string | null;
}) {
  getIO().emit("pickup-order:new", payload);
}

export function createPickupOrderSyncService(
  deps: PickupOrderSyncDependencies,
) {
  let running = false;

  async function syncPickupOrders(): Promise<PickupOrderSyncOutcome> {
    if (running) {
      return {
        pulled: 0,
        inserted: 0,
        updated: 0,
        emittedNewOrderCount: 0,
        cursorUpdatedAt: null,
        cursorOrderId: null,
      };
    }

    running = true;
    let pulled = 0;
    let inserted = 0;
    let cursorUpdatedAt: Date | null = null;
    let cursorOrderId: number | null = null;

    try {
      const state = await deps.getState();
      cursorUpdatedAt = state.cursorUpdatedAt;
      cursorOrderId = state.cursorOrderId;

      let hasMore = true;
      while (hasMore) {
        const page = await deps.fetchPage({
          ...(cursorUpdatedAt
            ? { updatedAfter: subtractCursorOverlap(cursorUpdatedAt) }
            : {}),
          ...(cursorOrderId ? { afterId: cursorOrderId } : {}),
          limit: SYNC_LIMIT,
        });

        if (page.items.length === 0) {
          hasMore = false;
          break;
        }

        const incomingIds = page.items.map((item) => item.id);
        const existingIds = await deps.findExistingIds(incomingIds);
        const newItems = page.items.filter((item) => !existingIds.has(item.id));

        await deps.upsertPage(page.items);

        pulled += page.items.length;
        inserted += newItems.length;
        if (newItems.length > 0) {
          deps.emitNewOrders({
            count: newItems.length,
            orderIds: newItems.map((item) => item.id),
            latestPickupStartsAt: latestPickupStartsAt(newItems),
          });
        }

        if (page.nextCursor) {
          cursorUpdatedAt = new Date(page.nextCursor.updatedAt);
          cursorOrderId = page.nextCursor.orderId;
          await deps.markSuccess({ cursorUpdatedAt, cursorOrderId });
        }

        hasMore = page.hasMore;
      }

      if (pulled === 0) {
        await deps.markSuccess({ cursorUpdatedAt, cursorOrderId });
      }

      const outcome = {
        pulled,
        inserted,
        updated: pulled - inserted,
        emittedNewOrderCount: inserted,
        cursorUpdatedAt,
        cursorOrderId,
      };
      void emitPickupPendingCount();
      return outcome;
    } catch (error) {
      await deps.markFailure(error);
      throw error;
    } finally {
      running = false;
    }
  }

  return { syncPickupOrders };
}

export const pickupOrderSyncService = createPickupOrderSyncService({
  fetchPage: fetchCrmPickupOrderSyncPage,
  getState: getPickupOrderSyncState,
  findExistingIds: findExistingPickupOrderIds,
  upsertPage: upsertPickupOrderPage,
  markSuccess: markPickupOrderSyncSuccess,
  markFailure: markPickupOrderSyncFailure,
  emitNewOrders: defaultEmitNewOrders,
});

export function triggerSyncPickupOrders() {
  pickupOrderSyncService.syncPickupOrders().catch((error) => {
    console.error("[pickup-order.sync] sync failed:", error);
  });
}

import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import {
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
  type PrintedHistoryBody,
  type PrintedHistoryQuery,
  type PrintedHistorySummary,
  type PrintedHistoryUser,
} from "./printed-history.types";

type PickupOrderFindUniqueArgs = {
  where: { crmOrderId: number };
  select: { crmOrderId: true };
};

type PrintedHistoryCreateArgs = {
  data: {
    entityType: string;
    entityId: number;
    userId?: number;
    userName?: string;
  };
  select: {
    id: true;
    entityType: true;
    entityId: true;
    printedAt: true;
    userId: true;
    userName: true;
  };
};

type PrintedHistoryGroupByArgs = {
  by: ["entityId"];
  where: {
    entityType: string;
    entityId: { in: number[] };
  };
  _count: { _all: true };
  orderBy: { entityId: "asc" };
};

type PrintedHistoryFindManyArgs = {
  where: {
    entityType: string;
    entityId: { in: number[] };
  };
  select: {
    entityId: true;
    printedAt: true;
    userId: true;
    userName: true;
  };
  orderBy: [{ printedAt: "desc" }, { id: "desc" }];
};

type PrintedHistoryCreateRow = {
  id: number;
  entityType: string;
  entityId: number;
  printedAt: Date;
  userId: number | null;
  userName: string | null;
};

type PrintedHistoryCountRow = {
  entityId: number;
  _count: { _all: number };
};

type PrintedHistoryLatestRow = {
  entityId: number;
  printedAt: Date;
  userId: number | null;
  userName: string | null;
};

export type PrintedHistoryClient = {
  pickupOrderCache: {
    findUnique: (
      args: PickupOrderFindUniqueArgs,
    ) => Promise<{ crmOrderId: number } | null>;
  };
  printedHistory: {
    create: (
      args: PrintedHistoryCreateArgs,
    ) => Promise<PrintedHistoryCreateRow>;
    groupBy: (
      args: PrintedHistoryGroupByArgs,
    ) => Promise<PrintedHistoryCountRow[]>;
    findMany: (
      args: PrintedHistoryFindManyArgs,
    ) => Promise<PrintedHistoryLatestRow[]>;
  };
};

const defaultPrintedHistoryClient = {
  pickupOrderCache: {
    findUnique: (args) => db.pickupOrderCache.findUnique(args),
  },
  printedHistory: {
    create: (args) => db.printedHistory.create(args),
    groupBy: async (args) => {
      const rows = await db.printedHistory.groupBy({
        by: ["entityId"],
        where: args.where,
        _count: { _all: true },
        orderBy: { entityId: "asc" },
      });

      return rows.map((row) => ({
        entityId: row.entityId,
        _count: { _all: row._count._all },
      }));
    },
    findMany: (args) => db.printedHistory.findMany(args),
  },
} satisfies PrintedHistoryClient;

async function assertEntityExists(
  body: PrintedHistoryBody,
  client: PrintedHistoryClient,
) {
  if (body.entityType === PRINTED_HISTORY_ENTITY_PICKUP_ORDER) {
    const order = await client.pickupOrderCache.findUnique({
      where: { crmOrderId: body.entityId },
      select: { crmOrderId: true },
    });

    if (!order) {
      throw new NotFoundException("Pickup order not found");
    }
  }
}

export function createPrintedHistoryService(
  client: PrintedHistoryClient = defaultPrintedHistoryClient,
) {
  return async (body: PrintedHistoryBody, user?: PrintedHistoryUser) => {
    try {
      await assertEntityExists(body, client);

      const row = await client.printedHistory.create({
        data: {
          entityType: body.entityType,
          entityId: body.entityId,
          userId: user?.id,
          userName: user?.name,
        },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          printedAt: true,
          userId: true,
          userName: true,
        },
      });

      return {
        ok: true,
        result: {
          ...row,
          printedAt: row.printedAt.toISOString(),
        },
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error("createPrintedHistoryService error:", e);
      throw new InternalServerException();
    }
  };
}

export function getPrintedHistorySummariesService(
  client: PrintedHistoryClient = defaultPrintedHistoryClient,
) {
  return async (query: PrintedHistoryQuery) => {
    try {
      const where = {
        entityType: query.entityType,
        entityId: { in: query.entityIds },
      };

      const counts = await client.printedHistory.groupBy({
        by: ["entityId"],
        where,
        _count: { _all: true },
        orderBy: { entityId: "asc" },
      });

      const latestRows = await client.printedHistory.findMany({
        where,
        select: {
          entityId: true,
          printedAt: true,
          userId: true,
          userName: true,
        },
        orderBy: [{ printedAt: "desc" }, { id: "desc" }],
      });

      const latestByEntityId = new Map<number, PrintedHistoryLatestRow>();
      for (const row of latestRows) {
        if (!latestByEntityId.has(row.entityId)) {
          latestByEntityId.set(row.entityId, row);
        }
      }

      const summaries: PrintedHistorySummary[] = [];
      for (const count of counts) {
        const latest = latestByEntityId.get(count.entityId);
        if (!latest) continue;

        summaries.push({
          entityId: count.entityId,
          printCount: count._count._all,
          lastPrintedAt: latest.printedAt.toISOString(),
          lastPrintedByUserId: latest.userId,
          lastPrintedByUserName: latest.userName,
        });
      }

      return { ok: true, result: summaries };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error("getPrintedHistorySummariesService error:", e);
      throw new InternalServerException();
    }
  };
}

export const markPrintedHistoryService = createPrintedHistoryService();
export const listPrintedHistorySummariesService =
  getPrintedHistorySummariesService();

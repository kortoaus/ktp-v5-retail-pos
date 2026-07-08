import assert from "node:assert/strict";
import test from "node:test";

import printedHistoryRouter from "./printed-history.router";
import {
  createPrintedHistoryService,
  getPrintedHistorySummariesService,
  type PrintedHistoryClient,
} from "./printed-history.service";
import {
  parsePrintedHistoryBody,
  parsePrintedHistoryQuery,
} from "./printed-history.validation";

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
};

type RouterWithStack = {
  stack: RouterLayer[];
};

test("parsePrintedHistoryBody accepts pickup order entity", () => {
  assert.deepEqual(
    parsePrintedHistoryBody({ entityType: "PICKUP_ORDER", entityId: 42 }),
    { entityType: "PICKUP_ORDER", entityId: 42 },
  );
});

test("parsePrintedHistoryBody rejects unsupported entity type", () => {
  assert.throws(
    () => parsePrintedHistoryBody({ entityType: "ITEM_SHEET", entityId: 42 }),
    /entityType must be a supported printed history entity type/,
  );
});

test("parsePrintedHistoryQuery parses comma-separated entity ids", () => {
  assert.deepEqual(
    parsePrintedHistoryQuery({
      entityType: "PICKUP_ORDER",
      entityIds: "42,43",
    }),
    { entityType: "PICKUP_ORDER", entityIds: [42, 43] },
  );
});

test("createPrintedHistoryService verifies pickup order and inserts history", async () => {
  const calls: unknown[] = [];
  const printedAt = new Date("2026-07-08T02:00:00.000Z");
  const client: PrintedHistoryClient = {
    pickupOrderCache: {
      findUnique: async (args) => {
        calls.push({ model: "pickupOrderCache", method: "findUnique", args });
        return { crmOrderId: 42 };
      },
    },
    printedHistory: {
      create: async (args) => {
        calls.push({ model: "printedHistory", method: "create", args });
        return {
          id: 7,
          entityType: "PICKUP_ORDER",
          entityId: 42,
          printedAt,
          userId: 12,
          userName: "Alice",
        };
      },
      groupBy: async () => [],
      findMany: async () => [],
    },
  };

  const service = createPrintedHistoryService(client);
  const result = await service(
    { entityType: "PICKUP_ORDER", entityId: 42 },
    { id: 12, name: "Alice" },
  );

  assert.deepEqual(calls, [
    {
      model: "pickupOrderCache",
      method: "findUnique",
      args: {
        where: { crmOrderId: 42 },
        select: { crmOrderId: true },
      },
    },
    {
      model: "printedHistory",
      method: "create",
      args: {
        data: {
          entityType: "PICKUP_ORDER",
          entityId: 42,
          userId: 12,
          userName: "Alice",
        },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          printedAt: true,
          userId: true,
          userName: true,
        },
      },
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    result: {
      id: 7,
      entityType: "PICKUP_ORDER",
      entityId: 42,
      printedAt: "2026-07-08T02:00:00.000Z",
      userId: 12,
      userName: "Alice",
    },
  });
});

test("getPrintedHistorySummariesService maps counts and latest print metadata", async () => {
  const client: PrintedHistoryClient = {
    pickupOrderCache: {
      findUnique: async () => ({ crmOrderId: 42 }),
    },
    printedHistory: {
      create: async () => {
        throw new Error("unexpected create call");
      },
      groupBy: async () => [
        { entityId: 42, _count: { _all: 2 } },
        { entityId: 43, _count: { _all: 1 } },
      ],
      findMany: async () => [
        {
          entityId: 42,
          printedAt: new Date("2026-07-08T03:00:00.000Z"),
          userId: 12,
          userName: "Alice",
        },
        {
          entityId: 43,
          printedAt: new Date("2026-07-08T04:00:00.000Z"),
          userId: null,
          userName: null,
        },
      ],
    },
  };

  const service = getPrintedHistorySummariesService(client);
  const result = await service({
    entityType: "PICKUP_ORDER",
    entityIds: [42, 43],
  });

  assert.deepEqual(result, {
    ok: true,
    result: [
      {
        entityId: 42,
        printCount: 2,
        lastPrintedAt: "2026-07-08T03:00:00.000Z",
        lastPrintedByUserId: 12,
        lastPrintedByUserName: "Alice",
      },
      {
        entityId: 43,
        printCount: 1,
        lastPrintedAt: "2026-07-08T04:00:00.000Z",
        lastPrintedByUserId: null,
        lastPrintedByUserName: null,
      },
    ],
  });
});

test("getPrintedHistorySummariesService keeps first latest row per entity id", async () => {
  const client: PrintedHistoryClient = {
    pickupOrderCache: {
      findUnique: async () => ({ crmOrderId: 42 }),
    },
    printedHistory: {
      create: async () => {
        throw new Error("unexpected create call");
      },
      groupBy: async () => [{ entityId: 42, _count: { _all: 3 } }],
      findMany: async () => [
        {
          entityId: 42,
          printedAt: new Date("2026-07-08T05:00:00.000Z"),
          userId: 13,
          userName: "Bob",
        },
        {
          entityId: 42,
          printedAt: new Date("2026-07-08T04:00:00.000Z"),
          userId: 12,
          userName: "Alice",
        },
        {
          entityId: 42,
          printedAt: new Date("2026-07-08T03:00:00.000Z"),
          userId: null,
          userName: null,
        },
      ],
    },
  };

  const service = getPrintedHistorySummariesService(client);
  const result = await service({
    entityType: "PICKUP_ORDER",
    entityIds: [42],
  });

  assert.deepEqual(result, {
    ok: true,
    result: [
      {
        entityId: 42,
        printCount: 3,
        lastPrintedAt: "2026-07-08T05:00:00.000Z",
        lastPrintedByUserId: 13,
        lastPrintedByUserName: "Bob",
      },
    ],
  });
});

test("printedHistoryRouter registers GET and POST root routes", () => {
  const router = printedHistoryRouter as unknown as RouterWithStack;
  const rootMethods = router.stack
    .filter((layer) => layer.route?.path === "/")
    .flatMap((layer) => Object.keys(layer.route?.methods ?? {}));

  assert.ok(rootMethods.includes("get"));
  assert.ok(rootMethods.includes("post"));
});

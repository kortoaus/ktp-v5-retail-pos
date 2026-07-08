import assert from "node:assert/strict";
import test from "node:test";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
  UnauthorizedException,
} from "../../libs/exceptions";
import {
  createUpdateCrmPickupOrderStatus,
} from "./pickup-order.crm";
import pickupOrderRouter from "./pickup-order.router";
import {
  parsePickupOrderStatusBody,
  updatePickupOrderStatusFromPos,
} from "./pickup-order.status";
import {
  canTransitionPickupOrderStatus,
  requiresManagerForPickupOrderStatusTransition,
} from "./pickup-order.status-policy";
import type { CrmPickupOrderWire } from "./pickup-order.types";

const pickupOrderWire: CrmPickupOrderWire = {
  id: 42,
  companyId: 1,
  documentId: "1-260707-042",
  status: "READY",
  memberId: "member-1",
  memberName: "Jane",
  memberLevel: 1,
  memberPhoneLast4: "1234",
  pickupStartsAt: "2026-07-08T01:00:00.000Z",
  linesTotal: 1500,
  total: 1500,
  createdAt: "2026-07-07T01:00:00.000Z",
  updatedAt: "2026-07-07T02:00:00.000Z",
  lines: [],
};

function makeCrmStatusUpdater(response: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: CrmPickupOrderWire | null;
}) {
  return createUpdateCrmPickupOrderStatus({
    post: async () => response,
  });
}

async function withPatchedPickupOrderCacheFindUnique<T>(
  findUniqueImpl: (args: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const pickupOrderCache = db.pickupOrderCache as {
    findUnique: typeof db.pickupOrderCache.findUnique;
  };
  const originalFindUnique = pickupOrderCache.findUnique;

  pickupOrderCache.findUnique = (async (args: unknown) =>
    findUniqueImpl(args)) as unknown as typeof pickupOrderCache.findUnique;

  try {
    return await run();
  } finally {
    pickupOrderCache.findUnique = originalFindUnique;
  }
}

test("parsePickupOrderStatusBody rejects customer cancellation from POS", () => {
  assert.throws(
    () => parsePickupOrderStatusBody({ status: "CANCELLED_BY_CUSTOMER" }),
    /status must be a POS pickup order status/,
  );
});

test("updatePickupOrderStatusFromPos sends CRM status and actor snapshot", async () => {
  const calls: unknown[] = [];
  const upserts: unknown[] = [];
  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "READY" },
      user: { id: 12, name: "Alice", scope: ["sale"] },
    },
    {
      getLocalPickupOrderStatus: async () => "ORDER_CONFIRMED",
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return pickupOrderWire;
      },
      upsertLocalPickupOrder: async (items) => {
        upserts.push(items);
      },
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "READY",
        actorId: "12",
        actorName: "Alice",
      },
    },
  ]);
  assert.deepEqual(upserts, [[pickupOrderWire]]);
});

test("pickup POS status policy marks ready cancellation as manager-only", () => {
  assert.equal(canTransitionPickupOrderStatus("READY", "CANCELLED_BY_STORE"), true);
  assert.equal(
    requiresManagerForPickupOrderStatusTransition("READY", "CANCELLED_BY_STORE"),
    true,
  );
  assert.equal(
    requiresManagerForPickupOrderStatusTransition("ORDER_CONFIRMED", "CANCELLED_BY_STORE"),
    false,
  );
});

test("updatePickupOrderStatusFromPos blocks ready cancellation for non-admin users", async () => {
  await assert.rejects(
    () =>
      updatePickupOrderStatusFromPos(
        {
          orderId: 42,
          body: { status: "CANCELLED_BY_STORE" },
          user: { id: 12, name: "Alice", scope: ["sale"] },
        },
        {
          getLocalPickupOrderStatus: async () => "READY",
          updateCrmStatus: async () => pickupOrderWire,
          upsertLocalPickupOrder: async () => undefined,
        },
      ),
    (error) =>
      error instanceof UnauthorizedException &&
      error.message === "Manager permission required",
  );
});

test("updatePickupOrderStatusFromPos allows ready cancellation for admin users", async () => {
  const calls: unknown[] = [];
  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "CANCELLED_BY_STORE" },
      user: { id: 1, name: "Manager", scope: ["admin"] },
    },
    {
      getLocalPickupOrderStatus: async () => "READY",
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "CANCELLED_BY_STORE" };
      },
      upsertLocalPickupOrder: async () => undefined,
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "CANCELLED_BY_STORE",
        actorId: "1",
        actorName: "Manager",
      },
    },
  ]);
});

test("pickupOrderRouter registers POST /:id/status before GET /:id", () => {
  const stack = (pickupOrderRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const statusIndex = stack.findIndex(
    (layer) => layer.route?.path === "/:id/status",
  );
  const detailIndex = stack.findIndex((layer) => layer.route?.path === "/:id");

  assert.ok(statusIndex >= 0);
  assert.ok(detailIndex >= 0);
  assert.equal(stack[statusIndex].route?.methods.post, true);
  assert.ok(statusIndex < detailIndex);
});

test("updateCrmPickupOrderStatus maps CRM 400 and 404 responses to BadRequestException", async () => {
  for (const status of [400, 404]) {
    const updateCrmStatus = makeCrmStatusUpdater({
      ok: false,
      status,
      msg: "CRM says no",
      result: null,
    });

    await assert.rejects(
      () => updateCrmStatus(42, { status: "READY" }),
      (error) =>
        error instanceof BadRequestException &&
        error.statusCode === 400 &&
        error.message === "CRM says no",
    );
  }
});

test("updateCrmPickupOrderStatus maps CRM 401 and 403 responses to UnauthorizedException", async () => {
  for (const status of [401, 403]) {
    const updateCrmStatus = makeCrmStatusUpdater({
      ok: false,
      status,
      msg: "No CRM auth",
      result: null,
    });

    await assert.rejects(
      () => updateCrmStatus(42, { status: "READY" }),
      (error) =>
        error instanceof UnauthorizedException &&
        error.statusCode === 401 &&
        error.message === "No CRM auth",
    );
  }
});

test("updateCrmPickupOrderStatus maps unavailable CRM responses to InternalServerException", async () => {
  for (const status of [0, 500, 503]) {
    const updateCrmStatus = makeCrmStatusUpdater({
      ok: false,
      status,
      msg: "Raw upstream outage",
      result: null,
    });

    await assert.rejects(
      () => updateCrmStatus(42, { status: "READY" }),
      (error) =>
        error instanceof InternalServerException &&
        error.statusCode === 500 &&
        error.message === "CRM pickup order service unavailable",
    );
  }
});

test("updateCrmPickupOrderStatus maps ok response without result to HttpException", async () => {
  const updateCrmStatus = makeCrmStatusUpdater({
    ok: true,
    msg: "Missing CRM result",
    result: null,
  });

  await assert.rejects(
    () => updateCrmStatus(42, { status: "READY" }),
    (error) =>
      error instanceof HttpException &&
      error.statusCode === 502 &&
      error.message === "Missing CRM result",
  );
});

test("updateCrmPickupOrderStatus returns successful CRM pickup order result", async () => {
  const calls: unknown[] = [];
  const updateCrmStatus = createUpdateCrmPickupOrderStatus({
    post: async (url, payload) => {
      calls.push({ url, payload });
      return {
        ok: true,
        status: 200,
        result: pickupOrderWire,
      };
    },
  });

  const result = await updateCrmStatus(42, {
    status: "READY",
    actorId: "12",
    actorName: "Alice",
  });

  assert.deepEqual(result, pickupOrderWire);
  assert.deepEqual(calls, [
    {
      url: "/device/pickup-order/42/status",
      payload: {
        status: "READY",
        actorId: "12",
        actorName: "Alice",
      },
    },
  ]);
});

test("pickup POS status policy allows ready completion and idempotent completed completion", () => {
  assert.equal(canTransitionPickupOrderStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionPickupOrderStatus("COMPLETED", "COMPLETED"), true);
});

test("pickup POS status policy rejects premature completion", () => {
  assert.equal(canTransitionPickupOrderStatus("PENDING", "COMPLETED"), false);
  assert.equal(
    canTransitionPickupOrderStatus("ORDER_CONFIRMED", "COMPLETED"),
    false,
  );
  assert.equal(
    canTransitionPickupOrderStatus("CANCELLED_BY_STORE", "COMPLETED"),
    false,
  );
  assert.equal(
    canTransitionPickupOrderStatus("CANCELLED_BY_CUSTOMER", "COMPLETED"),
    false,
  );
});

test("updatePickupOrderStatusFromPos completes READY pickup orders through CRM", async () => {
  const calls: unknown[] = [];
  const upserts: unknown[] = [];

  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "COMPLETED" },
      user: { id: 12, name: "Alice", scope: ["sale"] },
    },
    {
      getLocalPickupOrderStatus: async () => "READY",
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "COMPLETED" };
      },
      upsertLocalPickupOrder: async (items) => {
        upserts.push(items);
      },
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "COMPLETED",
        actorId: "12",
        actorName: "Alice",
      },
    },
  ]);
  assert.deepEqual(upserts, [[{ ...pickupOrderWire, status: "COMPLETED" }]]);
});

test("updatePickupOrderStatusFromPos treats COMPLETED to COMPLETED as local idempotent success", async () => {
  const calls: unknown[] = [];
  const upserts: unknown[] = [];
  const result = await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "COMPLETED" },
      user: { id: 12, name: "Alice", scope: ["sale"] },
    },
    {
      getLocalPickupOrderStatus: async () => "COMPLETED",
      getLocalPickupOrder: async () => ({
        ...pickupOrderWire,
        status: "COMPLETED",
      }),
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "COMPLETED" };
      },
      upsertLocalPickupOrder: async (items) => {
        upserts.push(items);
      },
    },
  );

  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(calls, []);
  assert.deepEqual(upserts, []);
});

test("updatePickupOrderStatusFromPos rejects PENDING and ORDER_CONFIRMED to COMPLETED", async () => {
  for (const fromStatus of ["PENDING", "ORDER_CONFIRMED"] as const) {
    await assert.rejects(
      () =>
        updatePickupOrderStatusFromPos(
          {
            orderId: 42,
            body: { status: "COMPLETED" },
            user: { id: 12, name: "Alice", scope: ["sale"] },
          },
          {
            getLocalPickupOrderStatus: async () => fromStatus,
            updateCrmStatus: async () => ({
              ...pickupOrderWire,
              status: "COMPLETED",
            }),
            upsertLocalPickupOrder: async () => undefined,
          },
        ),
      (error) =>
        error instanceof BadRequestException &&
        error.message === `Cannot change pickup order from ${fromStatus} to COMPLETED`,
    );
  }
});

test("updatePickupOrderStatusFromPos maps cached COMPLETED order from local cache on idempotent success", async () => {
  const queries: unknown[] = [];

  await withPatchedPickupOrderCacheFindUnique(
    async (args) => {
      queries.push(args);
      return {
        crmOrderId: 42,
        companyId: 1,
        documentId: "1-260708-001",
        status: "COMPLETED",
        memberId: "member-1",
        memberName: "Jane",
        memberLevel: 2,
        memberPhoneLast4: "6789",
        pickupStartsAt: new Date("2026-07-08T03:00:00.000Z"),
        linesTotal: 2500,
        total: 2500,
        crmCreatedAt: new Date("2026-07-08T01:00:00.000Z"),
        crmUpdatedAt: new Date("2026-07-08T02:00:00.000Z"),
        lines: [
          {
            crmLineId: 202,
            crmOrderId: 42,
            index: 2,
            itemId: 11,
            name_en: "Kimchi",
            name_ko: "김치",
            barcode: "222",
            code: "KIMCHI",
            uom: "EA",
            prices: [1200],
            promoPrices: [1100],
            memberLevel: 2,
            optionTotal: 100,
            qty: 1,
            total: 1300,
            note: "extra spicy",
            selectedOptionsSnapshot: [{ id: 1, name: "Spicy" }],
            crmCreatedAt: new Date("2026-07-08T01:10:00.000Z"),
            crmUpdatedAt: new Date("2026-07-08T01:20:00.000Z"),
          },
          {
            crmLineId: 201,
            crmOrderId: 42,
            index: 1,
            itemId: 10,
            name_en: "Rice",
            name_ko: "밥",
            barcode: "111",
            code: "RICE",
            uom: "EA",
            prices: [1200],
            promoPrices: [],
            memberLevel: 2,
            optionTotal: 0,
            qty: 1,
            total: 1200,
            note: null,
            selectedOptionsSnapshot: [],
            crmCreatedAt: new Date("2026-07-08T01:05:00.000Z"),
            crmUpdatedAt: new Date("2026-07-08T01:15:00.000Z"),
          },
        ],
      } as never;
    },
    async () => {
    const result = await updatePickupOrderStatusFromPos(
      {
        orderId: 42,
        body: { status: "COMPLETED" },
        user: { id: 12, name: "Alice", scope: ["sale"] },
      },
      {
        getLocalPickupOrderStatus: async () => "COMPLETED",
      },
    );

    assert.deepEqual(queries, [
      {
        where: { crmOrderId: 42 },
        include: { lines: { orderBy: { index: "asc" } } },
      },
    ]);
    assert.deepEqual(result, {
      id: 42,
      companyId: 1,
      documentId: "1-260708-001",
      status: "COMPLETED",
      memberId: "member-1",
      memberName: "Jane",
      memberLevel: 2,
      memberPhoneLast4: "6789",
      pickupStartsAt: "2026-07-08T03:00:00.000Z",
      linesTotal: 2500,
      total: 2500,
      createdAt: "2026-07-08T01:00:00.000Z",
      updatedAt: "2026-07-08T02:00:00.000Z",
      lines: [
        {
          id: 202,
          orderId: 42,
          index: 2,
          itemId: 11,
          name_en: "Kimchi",
          name_ko: "김치",
          barcode: "222",
          code: "KIMCHI",
          uom: "EA",
          prices: [1200],
          promoPrices: [1100],
          memberLevel: 2,
          optionTotal: 100,
          qty: 1,
          total: 1300,
          note: "extra spicy",
          selectedOptionsSnapshot: [{ id: 1, name: "Spicy" }],
          createdAt: "2026-07-08T01:10:00.000Z",
          updatedAt: "2026-07-08T01:20:00.000Z",
        },
        {
          id: 201,
          orderId: 42,
          index: 1,
          itemId: 10,
          name_en: "Rice",
          name_ko: "밥",
          barcode: "111",
          code: "RICE",
          uom: "EA",
          prices: [1200],
          promoPrices: [],
          memberLevel: 2,
          optionTotal: 0,
          qty: 1,
          total: 1200,
          note: null,
          selectedOptionsSnapshot: [],
          createdAt: "2026-07-08T01:05:00.000Z",
          updatedAt: "2026-07-08T01:15:00.000Z",
          },
        ],
      });
    },
  );
});

test("updatePickupOrderStatusFromPos throws NotFound for missing cached COMPLETED order on idempotent success", async () => {
  const queries: unknown[] = [];

  await withPatchedPickupOrderCacheFindUnique(
    async (args) => {
      queries.push(args);
      return null as never;
    },
    async () => {
    await assert.rejects(
      () =>
        updatePickupOrderStatusFromPos(
          {
            orderId: 42,
            body: { status: "COMPLETED" },
            user: { id: 12, name: "Alice", scope: ["sale"] },
          },
          {
            getLocalPickupOrderStatus: async () => "COMPLETED",
          },
        ),
      (error) =>
        error instanceof NotFoundException &&
        error.message === "Pickup order not found",
    );
    assert.deepEqual(queries, [
      {
        where: { crmOrderId: 42 },
        include: { lines: { orderBy: { index: "asc" } } },
      },
    ]);
    },
  );
});

test("updatePickupOrderStatusFromPos completes COMPLETED order through default cached status and wire lookups", async () => {
  const queries: unknown[] = [];

  await withPatchedPickupOrderCacheFindUnique(
    async (args) => {
      queries.push(args);

      if (
        typeof args === "object" &&
        args !== null &&
        "select" in args
      ) {
        return { status: "COMPLETED" } as never;
      }

      return {
        crmOrderId: 42,
        companyId: 1,
        documentId: "1-260708-002",
        status: "COMPLETED",
        memberId: "member-2",
        memberName: "Mina",
        memberLevel: 3,
        memberPhoneLast4: "2468",
        pickupStartsAt: new Date("2026-07-08T04:00:00.000Z"),
        linesTotal: 3400,
        total: 3400,
        crmCreatedAt: new Date("2026-07-08T02:00:00.000Z"),
        crmUpdatedAt: new Date("2026-07-08T03:00:00.000Z"),
        lines: [
          {
            crmLineId: 301,
            crmOrderId: 42,
            index: 1,
            itemId: 20,
            name_en: "Soup",
            name_ko: "국",
            barcode: "333",
            code: "SOUP",
            uom: "EA",
            prices: [1700],
            promoPrices: [],
            memberLevel: 3,
            optionTotal: 0,
            qty: 2,
            total: 3400,
            note: "hot",
            selectedOptionsSnapshot: [],
            crmCreatedAt: new Date("2026-07-08T02:05:00.000Z"),
            crmUpdatedAt: new Date("2026-07-08T02:10:00.000Z"),
          },
        ],
      } as never;
    },
    async () => {
      const result = await updatePickupOrderStatusFromPos({
        orderId: 42,
        body: { status: "COMPLETED" },
        user: { id: 12, name: "Alice", scope: ["sale"] },
      });

      assert.deepEqual(queries, [
        {
          where: { crmOrderId: 42 },
          select: { status: true },
        },
        {
          where: { crmOrderId: 42 },
          include: { lines: { orderBy: { index: "asc" } } },
        },
      ]);
      assert.deepEqual(result, {
        id: 42,
        companyId: 1,
        documentId: "1-260708-002",
        status: "COMPLETED",
        memberId: "member-2",
        memberName: "Mina",
        memberLevel: 3,
        memberPhoneLast4: "2468",
        pickupStartsAt: "2026-07-08T04:00:00.000Z",
        linesTotal: 3400,
        total: 3400,
        createdAt: "2026-07-08T02:00:00.000Z",
        updatedAt: "2026-07-08T03:00:00.000Z",
        lines: [
          {
            id: 301,
            orderId: 42,
            index: 1,
            itemId: 20,
            name_en: "Soup",
            name_ko: "국",
            barcode: "333",
            code: "SOUP",
            uom: "EA",
            prices: [1700],
            promoPrices: [],
            memberLevel: 3,
            optionTotal: 0,
            qty: 2,
            total: 3400,
            note: "hot",
            selectedOptionsSnapshot: [],
            createdAt: "2026-07-08T02:05:00.000Z",
            updatedAt: "2026-07-08T02:10:00.000Z",
          },
        ],
      });
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
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

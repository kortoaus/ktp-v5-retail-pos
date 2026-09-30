import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import {
  buildPickingBody,
  buildRefundRequestBody,
  buildRejectBody,
  mapCrmPaging,
  requireOk,
  requireRefundRequestOk,
  requireTransitionOk,
} from "./order.service";

test("requireOk returns the result on success", () => {
  const result = requireOk({ ok: true, result: [{ id: 1 }] });
  assert.deepEqual(result, [{ id: 1 }]);
});

test("requireOk maps crm 400/404 to BadRequestException", () => {
  assert.throws(
    () => requireOk({ ok: false, status: 400, msg: "invalid preset" }),
    (e: unknown) =>
      e instanceof BadRequestException && e.message === "invalid preset",
  );
  assert.throws(
    () => requireOk({ ok: false, status: 404 }),
    BadRequestException,
  );
});

test("requireOk maps crm 401/403 to UnauthorizedException", () => {
  assert.throws(
    () => requireOk({ ok: false, status: 401 }),
    UnauthorizedException,
  );
  assert.throws(
    () => requireOk({ ok: false, status: 403 }),
    UnauthorizedException,
  );
});

test("requireOk maps network failure (status 0) and 5xx to InternalServerException", () => {
  assert.throws(
    () => requireOk({ ok: false, status: 0 }),
    InternalServerException,
  );
  assert.throws(
    () => requireOk({ ok: false, status: 503 }),
    InternalServerException,
  );
});

test("requireOk maps unknown failures to a 502 HttpException", () => {
  assert.throws(
    () => requireOk({ ok: false }),
    (e: unknown) => e instanceof HttpException && e.statusCode === 502,
  );
});

test("requireOk treats ok:true with null result as a failure", () => {
  assert.throws(
    () => requireOk({ ok: true, result: null, status: 200 }),
    HttpException,
  );
});

// --- S2 피킹 프록시 ---

test("buildPickingBody injects the server-side pickerName and passes version/lines through", () => {
  assert.deepEqual(
    buildPickingBody(
      { version: 3, lines: [{ lineId: 1, pickedQty: 2 }] },
      "Alice",
    ),
    { version: 3, lines: [{ lineId: 1, pickedQty: 2 }], pickerName: "Alice" },
  );
});

test("buildPickingBody drops a client-supplied pickerName", () => {
  const built = buildPickingBody(
    { version: 1, lines: [], pickerName: "Mallory" },
    "Alice",
  );
  assert.equal(built.pickerName, "Alice");
  // pickerName 외 임의 키도 전달하지 않는다 — version/lines/pickerName 만.
  assert.deepEqual(Object.keys(built).sort(), [
    "lines",
    "pickerName",
    "version",
  ]);
});

test("buildPickingBody tolerates a non-object body (crm 400 handles validation)", () => {
  assert.deepEqual(buildPickingBody(undefined, "Alice"), {
    version: undefined,
    lines: undefined,
    pickerName: "Alice",
  });
  assert.deepEqual(buildPickingBody("junk", "Alice"), {
    version: undefined,
    lines: undefined,
    pickerName: "Alice",
  });
});

test("requireOk passes a crm 409 TRANSITION_CONFLICT through as HttpException(409)", () => {
  assert.throws(
    () => requireOk({ ok: false, status: 409, msg: "TRANSITION_CONFLICT" }),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      e.message === "TRANSITION_CONFLICT",
  );
});

test("mapCrmPaging converts crm paging to the local shape", () => {
  assert.deepEqual(mapCrmPaging({ page: 1, limit: 20, total: 45, totalPages: 3 }), {
    currentPage: 1,
    totalPages: 3,
    hasPrev: false,
    hasNext: true,
    total: 45,
  });
  assert.deepEqual(mapCrmPaging({ page: 3, limit: 20, totalPages: 3 }), {
    currentPage: 3,
    totalPages: 3,
    hasPrev: true,
    hasNext: false,
  });
});

test("mapCrmPaging returns null for missing or malformed paging", () => {
  assert.equal(mapCrmPaging(null), null);
  assert.equal(mapCrmPaging(undefined), null);
  assert.equal(mapCrmPaging({ page: "x", totalPages: 3 }), null);
  assert.equal(mapCrmPaging("paging"), null);
});

// --- 2026-09-24 딜리버리 전이: 결제 사유 코드 보존 (J6) ---

test("requireTransitionOk passes crm 402 PAYMENT_CAPTURE_FAILED through with its reason", () => {
  assert.throws(
    () =>
      requireTransitionOk({
        ok: false,
        status: 402,
        msg: "PAYMENT_CAPTURE_FAILED",
        result: { reason: "AUTH_EXPIRED" },
      }),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 402 &&
      e.message === "PAYMENT_CAPTURE_FAILED" &&
      (e.result as { reason: string }).reason === "AUTH_EXPIRED",
  );
});

test("requireTransitionOk keeps coded crm 503s instead of the generic unavailable message", () => {
  for (const code of ["PAYMENT_PROVIDER_UNAVAILABLE", "STRIPE_NOT_CONFIGURED"]) {
    assert.throws(
      () => requireTransitionOk({ ok: false, status: 503, msg: code }),
      (e: unknown) =>
        e instanceof HttpException && e.statusCode === 503 && e.message === code,
    );
  }
});

test("requireTransitionOk falls back to requireOk for uncoded 5xx, network and 409", () => {
  assert.throws(
    () => requireTransitionOk({ ok: false, status: 500, msg: "Internal Server Error" }),
    (e: unknown) =>
      e instanceof InternalServerException &&
      e.message === "CRM order service unavailable",
  );
  assert.throws(
    () => requireTransitionOk({ ok: false, status: 0, msg: "Network Error" }),
    InternalServerException,
  );
  assert.throws(
    () => requireTransitionOk({ ok: false, status: 409, msg: "TRANSITION_CONFLICT" }),
    (e: unknown) =>
      e instanceof HttpException && e.statusCode === 409 && e.message === "TRANSITION_CONFLICT",
  );
  assert.deepEqual(requireTransitionOk({ ok: true, result: { id: 1 } }), { id: 1 });
});

test("mapCrmPaging echoes the triage bucket and asOf when crm sends them", () => {
  assert.deepEqual(
    mapCrmPaging({
      page: 1,
      limit: 100,
      total: 3,
      totalPages: 1,
      bucket: "delivery.tomorrow",
      asOf: "2026-09-24T05:00:00.000Z",
    }),
    {
      currentPage: 1,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
      total: 3,
      bucket: "delivery.tomorrow",
      asOf: "2026-09-24T05:00:00.000Z",
    },
  );
});

test("buildRejectBody injects the server-side staffName and drops a client one", () => {
  assert.deepEqual(
    buildRejectBody({ version: 3, reason: "Out of stock", staffName: "spoof" }, "  Kim "),
    { version: 3, reason: "Out of stock", staffName: "Kim" },
  );
  assert.deepEqual(buildRejectBody({ version: 3, reason: "x" }, "   "), {
    version: 3,
    reason: "x",
  });
});

test("buildRefundRequestBody sets source/terminal/staff on the server and ignores app copies", () => {
  const body = buildRefundRequestBody(
    {
      requestKey: "k-1",
      reason: "PICKING_SHORTFALL",
      lines: [{ lineId: 7, qty: 1 }],
      note: "short 1",
      source: "RUNNER",
      sourceTerminal: "spoof",
      requestedByName: "spoof",
    },
    { terminalName: "Till 2", staffName: "Kim" },
  );
  assert.deepEqual(body, {
    requestKey: "k-1",
    reason: "PICKING_SHORTFALL",
    lines: [{ lineId: 7, qty: 1 }],
    note: "short 1",
    source: "POS",
    sourceTerminal: "Till 2",
    requestedByName: "Kim",
  });
});

test("buildRefundRequestBody passes an amount-only request through", () => {
  const body = buildRefundRequestBody(
    { requestKey: "k-2", reason: "CUSTOMER_REQUEST", amount: 1250 },
    { terminalName: "", staffName: "Lee" },
  );
  assert.equal(body.amount, 1250);
  assert.equal("lines" in body, false);
});

test("buildRefundRequestBody rejects the SYSTEM-only reason and unknown reasons locally", () => {
  assert.throws(
    () =>
      buildRefundRequestBody(
        { requestKey: "k", reason: "REJECTED_AFTER_CAPTURE", amount: 100 },
        { terminalName: "T", staffName: "S" },
      ),
    BadRequestException,
  );
  assert.throws(
    () => buildRefundRequestBody({ requestKey: "k" }, { terminalName: "T", staffName: "S" }),
    BadRequestException,
  );
});

test("requireRefundRequestOk keeps crm 409 AMOUNT_EXCEEDS_REFUNDABLE with its refundable", () => {
  assert.throws(
    () =>
      requireRefundRequestOk({
        ok: false,
        status: 409,
        msg: "AMOUNT_EXCEEDS_REFUNDABLE",
        result: { refundable: 1399 },
      }),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      e.message === "AMOUNT_EXCEEDS_REFUNDABLE" &&
      (e.result as { refundable: number }).refundable === 1399,
  );
  // 문구형 400 은 기존 requireOk 매핑 (BadRequestException)
  assert.throws(
    () => requireRefundRequestOk({ ok: false, status: 400, msg: "note is required for OTHER" }),
    BadRequestException,
  );
});

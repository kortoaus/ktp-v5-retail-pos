import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { buildPickingBody, mapCrmPaging, requireOk } from "./order.service";

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
  });
  assert.deepEqual(mapCrmPaging({ page: 3, limit: 20, total: 45, totalPages: 3 }), {
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

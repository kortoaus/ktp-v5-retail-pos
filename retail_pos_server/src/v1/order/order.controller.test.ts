import assert from "node:assert/strict";
import test from "node:test";

import { UnauthorizedException } from "../../libs/exceptions";
import { resolvePickerName } from "./order.controller";

// --- S2 피킹 프록시: pickerName 정규화(컨트롤러 책임) ---

test("resolvePickerName trims the staff name and caps it at 50 chars", () => {
  assert.equal(resolvePickerName({ name: "  Alice  " }), "Alice");
  assert.equal(resolvePickerName({ name: "a".repeat(60) }), "a".repeat(50));
});

test("resolvePickerName rejects a blank staff name locally, never forwarding it to crm", () => {
  assert.throws(
    () => resolvePickerName({ name: "" }),
    (e: unknown) =>
      e instanceof UnauthorizedException &&
      e.message === "Staff user has no display name",
  );
  assert.throws(
    () => resolvePickerName({ name: "   " }),
    UnauthorizedException,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { normalizeUserScopes, POS_USER_SCOPES } from "./user.scopes";

test("POS_USER_SCOPES includes refund_ticket alongside the store refund scope", () => {
  assert.ok(POS_USER_SCOPES.includes("refund_ticket"));
  assert.ok(POS_USER_SCOPES.includes("refund"));
});

test("normalizeUserScopes keeps known scopes and de-duplicates in order", () => {
  assert.deepEqual(
    normalizeUserScopes(["sale", "refund_ticket", "sale"]),
    ["sale", "refund_ticket"],
  );
  assert.deepEqual(normalizeUserScopes([]), []);
});

test("normalizeUserScopes rejects unknown scopes and non-arrays", () => {
  assert.throws(() => normalizeUserScopes(["sale", "manager"]), BadRequestException);
  assert.throws(() => normalizeUserScopes("sale"), BadRequestException);
  assert.throws(() => normalizeUserScopes([1]), BadRequestException);
});

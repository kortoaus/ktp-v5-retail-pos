import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { normalizeExternalOrderId } from "./sale.create.service";

// S3 — externalOrderId payload 정규화 (field-allowlist 관례).

test("undefined / null → null (주문 연계 없음)", () => {
  assert.equal(normalizeExternalOrderId(undefined), null);
  assert.equal(normalizeExternalOrderId(null), null);
});

test("valid string passes through trimmed", () => {
  assert.equal(normalizeExternalOrderId("123"), "123");
  assert.equal(normalizeExternalOrderId("  42  "), "42");
  assert.equal(normalizeExternalOrderId("a".repeat(64)), "a".repeat(64));
});

test("non-string types are rejected", () => {
  for (const bad of [123, true, {}, [], 12.5]) {
    assert.throws(() => normalizeExternalOrderId(bad), BadRequestException);
  }
});

test("empty / whitespace-only / over-64 strings are rejected", () => {
  assert.throws(() => normalizeExternalOrderId(""), BadRequestException);
  assert.throws(() => normalizeExternalOrderId("   "), BadRequestException);
  assert.throws(
    () => normalizeExternalOrderId("a".repeat(65)),
    BadRequestException,
  );
});

// node --experimental-strip-types src/renderer/src/store/cart-line-remove.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { removeLineFromCart } from "./cart-line-remove.ts";

// 테스트에 필요한 최소 라인 셰이프 — 리듀서는 lineKey/index 만 본다.
function makeLine(lineKey, index) {
  return { lineKey, index, name_en: `Line ${lineKey}`, qty: 1000 };
}

function makeOrderCart(lines) {
  return {
    lines,
    member: { id: "m-1", name: "Kim", level: 1, phone_last4: null, points: null },
    externalOrderId: "42",
    orderNo: "CC-260821-004",
  };
}

test("removing one of several lines keeps the order marking", () => {
  const cart = makeOrderCart([makeLine("a", 0), makeLine("b", 1)]);
  const next = removeLineFromCart(cart, "a");
  assert.ok(next);
  assert.deepEqual(
    next.lines.map((l) => l.lineKey),
    ["b"],
  );
  assert.equal(next.lines[0].index, 0); // 재인덱싱
  assert.equal(next.externalOrderId, "42");
  assert.equal(next.orderNo, "CC-260821-004");
});

test("removing the last line clears the order marking (abandon semantics)", () => {
  const cart = makeOrderCart([makeLine("a", 0)]);
  const next = removeLineFromCart(cart, "a");
  assert.ok(next);
  assert.deepEqual(next.lines, []);
  assert.equal(next.externalOrderId, null);
  assert.equal(next.orderNo, null);
  // 멤버는 유지 — Clear Cart 가 아니라 라인만 비운 것.
  assert.equal(next.member?.id, "m-1");
});

test("unknown lineKey returns null (caller no-op)", () => {
  const cart = makeOrderCart([makeLine("a", 0)]);
  assert.equal(removeLineFromCart(cart, "zzz"), null);
});

test("unmarked cart empties without touching marking fields", () => {
  const cart = {
    lines: [makeLine("a", 0)],
    member: null,
    externalOrderId: null,
    orderNo: null,
  };
  const next = removeLineFromCart(cart, "a");
  assert.ok(next);
  assert.equal(next.externalOrderId, null);
  assert.equal(next.orderNo, null);
});

// npm run test:orders — F-23 / D-16 (rule retail-pos/refund-weighed-rows-whole-only):
// the till offers a weighed row whole or not at all — a toggle, never a numpad.
import assert from "node:assert/strict";
import test from "node:test";

const { isWeighedRow, rowRefundable, rowQtyTap } = await import("./compute.ts");

const row = (type, qty, refunded_qty = 0) => ({ type, qty, refunded_qty });

test("WEIGHT and WEIGHT_PREPACKED are weighed; NORMAL and PREPACKED are not", () => {
  assert.equal(isWeighedRow(row("WEIGHT", 1500)), true);
  assert.equal(isWeighedRow(row("WEIGHT_PREPACKED", 820)), true);
  assert.equal(isWeighedRow(row("NORMAL", 2000)), false);
  assert.equal(isWeighedRow(row("PREPACKED", 1000)), false);
});

test("WEIGHT row tap toggles whole ↔ none, never opens the numpad", () => {
  const r = row("WEIGHT", 1500);
  assert.deepEqual(rowQtyTap(r, 0), { kind: "toggle", qty: 1500 });
  assert.deepEqual(rowQtyTap(r, 1500), { kind: "toggle", qty: 0 });
});

test("WEIGHT_PREPACKED keeps the same whole-row toggle", () => {
  assert.deepEqual(rowQtyTap(row("WEIGHT_PREPACKED", 820), 0), { kind: "toggle", qty: 820 });
});

test("NORMAL row opens the (integer) numpad", () => {
  assert.deepEqual(rowQtyTap(row("NORMAL", 3000), 0), { kind: "numpad" });
});

test("weighed row cap is the original qty; a legacy partial refund leaves nothing refundable", () => {
  assert.equal(rowRefundable(row("WEIGHT", 1500)), 1500);
  assert.equal(rowRefundable(row("WEIGHT", 1500, 500)), 0);
  assert.deepEqual(rowQtyTap(row("WEIGHT", 1500, 500), 0), { kind: "none" });
  assert.equal(rowRefundable(row("NORMAL", 3000, 1000)), 2000);
});

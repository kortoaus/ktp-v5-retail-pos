// npm run test:label-core
//
// The level-array editor's two rules: fill-down from the edited level, and the
// array's length is preserved (padded up to the window, never truncated) so the
// 2D PP payload can carry it through verbatim.

import assert from "node:assert/strict";
import test from "node:test";

import { editPriceLevel, padToLevelCount } from "./scale-price-levels.ts";

test("padToLevelCount: pads short arrays with zeros", () => {
  assert.deepEqual(padToLevelCount([2599]), [2599, 0, 0, 0, 0]);
  assert.deepEqual(padToLevelCount(null), [0, 0, 0, 0, 0]);
  assert.deepEqual(padToLevelCount([]), [0, 0, 0, 0, 0]);
});

test("padToLevelCount: a longer array keeps its tail — never truncated", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(padToLevelCount(ten), ten);
});

test("padToLevelCount: the input is never mutated", () => {
  const input = [2599];
  const out = padToLevelCount(input);
  out[1] = 999;
  assert.deepEqual(input, [2599]);
});

test("editPriceLevel: fills down from the edited level to the end of the window", () => {
  assert.deepEqual(editPriceLevel([2599, 2399, 2199, 1999, 1899], 2, 1500), [
    2599, 2399, 1500, 1500, 1500,
  ]);
  assert.deepEqual(editPriceLevel([2599, 2399, 2199, 1999, 1899], 0, 1000), [
    1000, 1000, 1000, 1000, 1000,
  ]);
  assert.deepEqual(editPriceLevel([2599, 2399, 2199, 1999, 1899], 4, 0), [
    2599, 2399, 2199, 1999, 0,
  ]);
});

test("editPriceLevel: fill-down stops at the window, leaving deeper tiers alone", () => {
  const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.deepEqual(editPriceLevel(ten, 1, 5), [10, 5, 5, 5, 5, 60, 70, 80, 90, 100]);
});

test("editPriceLevel: out-of-range levels clamp or no-op, always returning a padded copy", () => {
  assert.deepEqual(editPriceLevel([2599], -1, 100), [100, 100, 100, 100, 100]);
  assert.deepEqual(editPriceLevel([2599], 9, 100), [2599, 0, 0, 0, 0]);
});

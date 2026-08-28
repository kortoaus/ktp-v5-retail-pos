// npm run test:scale-core
//
// Ported from `ktpv5-retail-runner/scripts/tests/weigh-pricing.test.ts` along
// with the module it covers. The canonical lowest-of face price (a mirror of
// the POS's `resolveDiscountedPrice`), the total's rounding order, and the
// negative-price clamp on both markdown branches — the clamp the legacy scale
// fork was missing.
//
// Expectations are written as concrete integers rather than recomputed from the
// formula, so a drift in the formula breaks the test instead of moving with it.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyAmtMarkdown,
  applyMarkdown,
  applyPctMarkdown,
  computeTotalCents,
  formatCentsToDollars,
  MONEY_SCALE,
  parseWeightGrams,
  PCT_SCALE,
  PRICE_LEVEL_COUNT,
  QTY_SCALE,
  resolveFacePrice,
} from "./weigh-pricing.ts";

test("scale constants match the fleet-wide values", () => {
  assert.equal(MONEY_SCALE, 100);
  assert.equal(QTY_SCALE, 1000);
  assert.equal(PCT_SCALE, 1000);
});

test("PRICE_LEVEL_COUNT: owner decree — 5 levels (indexes 0..4)", () => {
  assert.equal(PRICE_LEVEL_COUNT, 5);
});

test("parseWeightGrams: 5-digit padded string, junk → 0", () => {
  assert.equal(parseWeightGrams("01036"), 1036);
  assert.equal(parseWeightGrams("00000"), 0);
  assert.equal(parseWeightGrams("garbage"), 0);
});

test("resolveFacePrice: promo[0] below price[0] wins at level 0", () => {
  assert.deepEqual(resolveFacePrice([2599], [1999]), {
    originalCents: 2599,
    effectiveCents: 1999,
    discountedCents: 1999,
  });
});

test("resolveFacePrice: promo ABOVE base is rejected (lowest-of, not promo-wins)", () => {
  // Under the legacy rule 2999 would have become the unit price. Lowest-of
  // only accepts candidates below the shelf price.
  assert.deepEqual(resolveFacePrice([2599], [2999]), {
    originalCents: 2599,
    effectiveCents: 2599,
    discountedCents: null,
  });
  // A promo equal to the shelf price is not a discount either (strict `<`).
  assert.deepEqual(resolveFacePrice([2599], [2599]), {
    originalCents: 2599,
    effectiveCents: 2599,
    discountedCents: null,
  });
});

test("resolveFacePrice: zero/negative slots are ignored as candidates", () => {
  assert.deepEqual(resolveFacePrice([2599], [0]), {
    originalCents: 2599,
    effectiveCents: 2599,
    discountedCents: null,
  });
  assert.deepEqual(resolveFacePrice([2599, 0], [0, 0], 1), {
    originalCents: 2599,
    effectiveCents: 2599,
    discountedCents: null,
  });
});

test("resolveFacePrice: null/empty arrays → 0 original, no discount", () => {
  assert.deepEqual(resolveFacePrice(null, null), {
    originalCents: 0,
    effectiveCents: 0,
    discountedCents: null,
  });
  // With a shelf price of 0 nothing can be below it, so a promo alone does not
  // form a price — same as the POS.
  assert.deepEqual(resolveFacePrice([], [1500]), {
    originalCents: 0,
    effectiveCents: 0,
    discountedCents: null,
  });
});

test("resolveFacePrice: level pulls in deeper slots of BOTH arrays (POS mirror)", () => {
  const prices = [2599, 2399, 2199, 1999, 1899];
  const promo = [2499, 0, 1000, 0, 0];
  // Level 2 candidates: price[1]=2399, price[2]=2199, promo[0]=2499,
  // promo[2]=1000 → minimum 1000.
  assert.deepEqual(resolveFacePrice(prices, promo, 2), {
    originalCents: 2599,
    effectiveCents: 1000,
    discountedCents: 1000,
  });
  // At level 0 (an anonymous label) only promo[0]=2499 remains.
  assert.deepEqual(resolveFacePrice(prices, promo, 0), {
    originalCents: 2599,
    effectiveCents: 2499,
    discountedCents: 2499,
  });
});

test("resolveFacePrice: negative level clamps to 0 (POS maxLevel guard mirror)", () => {
  assert.deepEqual(resolveFacePrice([2599, 1000], [1999], -3), {
    originalCents: 2599,
    effectiveCents: 1999,
    discountedCents: 1999,
  });
});

test("computeTotalCents: weight item — $25.99/kg × 1.036kg = $26.93 (round once)", () => {
  // 25.99 × 1.036 = 26.92564 → 2693 (legacy order: one rounding, at the end).
  assert.equal(computeTotalCents(2599, true, 1036), 2693);
});

test("computeTotalCents: fixed item ignores weight", () => {
  assert.equal(computeTotalCents(2599, false, 0), 2599);
  assert.equal(computeTotalCents(2599, false, 1036), 2599);
});

test("computeTotalCents: weight item without weight → null; no unit price → null", () => {
  assert.equal(computeTotalCents(2599, true, 0), null);
  assert.equal(computeTotalCents(null, true, 1036), null);
});

test("applyPctMarkdown: 30% (300 permill) off 2693 → 1885", () => {
  // 2693 × 0.7 = 1885.1 → 1885
  assert.equal(applyPctMarkdown(2693, 300), 1885);
});

test("applyPctMarkdown: NEGATIVE-PRICE CLAMP — >100% discount floors at 0", () => {
  // The legacy scale fork's calcMarkdownPrice had no clamp and went negative.
  assert.equal(applyPctMarkdown(2693, 1500), 0);
  assert.equal(applyPctMarkdown(2693, 1000), 0); // exactly 100%
  assert.equal(applyPctMarkdown(0, 500), 0);
});

test("applyPctMarkdown mirrors pp-barcode calcMarkdownPrice pct branch", () => {
  // Canonical formula: Math.max(0, Math.round(price × (1000 − permill) / 1000)).
  assert.equal(applyPctMarkdown(999, 333), 666); // 999×0.667=666.333 → 666
  assert.equal(applyPctMarkdown(1000, 1), 999);
});

test("applyAmtMarkdown mirrors pp-barcode calcMarkdownPrice amt branch", () => {
  assert.equal(applyAmtMarkdown(2693, 500), 2193);
  assert.equal(applyAmtMarkdown(2693, 0), 2693);
});

test("applyAmtMarkdown: NEGATIVE-PRICE CLAMP — amount above price floors at 0", () => {
  assert.equal(applyAmtMarkdown(2693, 5000), 0);
  assert.equal(applyAmtMarkdown(2693, 2693), 0); // exactly the price
  assert.equal(applyAmtMarkdown(0, 100), 0);
});

test("applyMarkdown convenience dispatches to the right branch", () => {
  assert.equal(applyMarkdown(2693, "pct", 300), applyPctMarkdown(2693, 300));
  assert.equal(applyMarkdown(2693, "amt", 500), applyAmtMarkdown(2693, 500));
  assert.equal(applyMarkdown(2693, "pct", 300), 1885);
  assert.equal(applyMarkdown(2693, "amt", 500), 2193);
});

test("formatCentsToDollars", () => {
  assert.equal(formatCentsToDollars(2693), "26.93");
  assert.equal(formatCentsToDollars(0), "0.00");
  assert.equal(formatCentsToDollars(5), "0.05");
});

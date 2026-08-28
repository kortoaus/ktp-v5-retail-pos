// npm run test:scale-core
//
// Ported from `ktpv5-retail-runner/scripts/tests/label-data.test.ts` along with
// the module it covers: EAN-13 check digit, the 5-digit embedded-price rule,
// the legacy decision order and failure strings, pluOnly, the markdown fold
// (through the clamp), fixed-weight display — and the 2D PP invariant pin:
// pricesRaw/promoPricesRaw carry the original arrays, markdown never folded in.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ean13CheckDigit, makeLabelData } from "./label-data.ts";

function baseInput(overrides = {}) {
  return {
    name_en: "Pork Belly",
    prices: [2599],
    promoPrices: null,
    weight: "01036",
    is_weight: true,
    fixed_net_weight: "",
    packedOnDisplay: "21 Aug 26",
    usedByDisplay: "23 Aug 26",
    barcode: "0200123",
    unit: "kg",
    ingredients: "Pork",
    ...overrides,
  };
}

test("ean13CheckDigit: known GS1 vectors", () => {
  assert.equal(ean13CheckDigit("400638133393"), "1"); // 4006381333931
  assert.equal(ean13CheckDigit("590123412345"), "7"); // 5901234123457
  assert.equal(ean13CheckDigit("020012302693"), "6");
});

test("ean13CheckDigit: rejects non-12-digit input", () => {
  assert.equal(ean13CheckDigit("12345678901"), null);
  assert.equal(ean13CheckDigit("1234567890123"), null);
  assert.equal(ean13CheckDigit("12345678901a"), null);
});

test("weight item, embedded price: $25.99/kg × 1.036kg → 02693 embedded + checkdigit", () => {
  const out = makeLabelData(baseInput());
  assert.notEqual(typeof out, "string");
  if (typeof out === "string") return;
  assert.equal(out.unitPrice, "25.99");
  assert.equal(out.wasPrice, null);
  assert.equal(out.totalPrice, "26.93");
  assert.equal(out.wasTotalPrice, null);
  assert.equal(out.weight, "1.036");
  // 7-digit PLU + 5-digit embedded price = the printer's 12-digit input.
  assert.equal(out.barcode, "020012302693");
  assert.equal(out.barcodeWithCheckDigit, "0200123026936");
  assert.equal(out.barcodeFormat, "ean13");
  assert.equal(out.packedOn, "21 Aug 26");
  assert.equal(out.usedBy, "23 Aug 26");
});

test("the embedded price is the till's `embededPriceParser` window (digits 8–12)", () => {
  // libs/scan-utils.ts reads rawBarcode.slice(7, 12) as cents. This pins the
  // two halves of that contract together: what the label writes is what the
  // sale screen reads back.
  const out = makeLabelData(baseInput());
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.barcode.slice(7, 12), "02693");
  assert.equal(Number.parseInt(out.barcode.slice(7, 12), 10) / 100, 26.93);
});

test("promo[0] below price[0] discounts; original becomes wasPrice (lowest-of)", () => {
  const out = makeLabelData(baseInput({ promoPrices: [1999] }));
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.unitPrice, "19.99");
  assert.equal(out.wasPrice, "25.99");
  // 19.99 × 1.036 = 20.70964 → 20.71
  assert.equal(out.totalPrice, "20.71");
});

test("promo ABOVE base is rejected — no discount, no wasPrice", () => {
  const out = makeLabelData(baseInput({ promoPrices: [2999] }));
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.unitPrice, "25.99");
  assert.equal(out.wasPrice, null);
  assert.equal(out.totalPrice, "26.93");
});

test("pct markdown folds into total AND the embedded barcode; original total exposed as wasTotalPrice", () => {
  const out = makeLabelData(baseInput({ markdown: { type: "pct", value: 300 } }));
  if (typeof out === "string") return assert.fail(out);
  // 2693 × 0.7 = 1885.1 → 1885
  assert.equal(out.totalPrice, "18.85");
  assert.equal(out.wasTotalPrice, "26.93");
  assert.equal(out.barcode, "020012301885");
});

test("amt markdown folds into total AND the embedded barcode", () => {
  const out = makeLabelData(baseInput({ markdown: { type: "amt", value: 500 } }));
  if (typeof out === "string") return assert.fail(out);
  // 2693 − 500 = 2193
  assert.equal(out.totalPrice, "21.93");
  assert.equal(out.wasTotalPrice, "26.93");
  assert.equal(out.barcode, "020012302193");
});

test("markdown NEGATIVE-PRICE CLAMP survives through label data (>100% / over-amount → $0.00)", () => {
  const pct = makeLabelData(baseInput({ markdown: { type: "pct", value: 1500 } }));
  if (typeof pct === "string") return assert.fail(pct);
  assert.equal(pct.totalPrice, "0.00");
  assert.equal(pct.barcode, "020012300000");

  const amt = makeLabelData(baseInput({ markdown: { type: "amt", value: 99999 } }));
  if (typeof amt === "string") return assert.fail(amt);
  assert.equal(amt.totalPrice, "0.00");
});

test("ANTI-DOUBLE-DISCOUNT PIN: pricesRaw/promoPricesRaw stay verbatim under markdown; only the 1D total folds", () => {
  // The 2D PP invariant (see label-data.ts's header): 02/03 carry the original
  // arrays, markdown rides only in 05/06. Folded here = double discount at the
  // till.
  const prices = [2599, 2399, 2199, 1999, 1899];
  const promoPrices = [1999, 0, 0, 0, 0];
  const markdown = { type: "pct", value: 300 };
  const out = makeLabelData(baseInput({ prices, promoPrices, markdown }));
  if (typeof out === "string") return assert.fail(out);

  // 1D fold: effective 1999 × 1.036 = 2071 → ×0.7 = 1449.7 → 1450.
  assert.equal(out.totalPrice, "14.50");
  assert.equal(out.barcode, "020012301450");
  assert.equal(out.barcodeWithCheckDigit?.length, 13);

  // The original arrays, at the length they arrived, with no trace of markdown.
  assert.deepEqual(out.pricesRaw, [2599, 2399, 2199, 1999, 1899]);
  assert.deepEqual(out.promoPricesRaw, [1999, 0, 0, 0, 0]);
  // Markdown as its own field only.
  assert.deepEqual(out.markdown, { type: "pct", value: 300 });
});

test("markdown value 0 normalizes to null (no 05/06 emission, no fold)", () => {
  const out = makeLabelData(baseInput({ markdown: { type: "pct", value: 0 } }));
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.markdown, null);
  assert.equal(out.totalPrice, "26.93");
  assert.equal(out.wasTotalPrice, null);
});

test("ISO data-spec date fields carried verbatim, separate from display strings", () => {
  const out = makeLabelData(
    baseInput({ packedOnIso: "2026-08-21", usedByOffsetDays: 2 }),
  );
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.packedOnIso, "2026-08-21");
  assert.equal(out.usedByOffsetDays, 2);
  assert.equal(out.packedOn, "21 Aug 26"); // display string untouched
  assert.equal(out.usedBy, "23 Aug 26");

  // Absent → null (a display-only call is still valid).
  const bare = makeLabelData(baseInput());
  if (typeof bare === "string") return assert.fail(bare);
  assert.equal(bare.packedOnIso, null);
  assert.equal(bare.usedByOffsetDays, null);
});

test("fixed-weight item: unit price is the total, fixed_net_weight displayed", () => {
  const out = makeLabelData(
    baseInput({ is_weight: false, weight: "00000", fixed_net_weight: "500g" }),
  );
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.totalPrice, "25.99");
  assert.equal(out.weight, "500g");
  // 25.99 → "2599" → padded "02599"
  assert.equal(out.barcode, "020012302599");
});

test("fixed-weight item without fixed_net_weight shows N/A", () => {
  const out = makeLabelData(
    baseInput({ is_weight: false, weight: "00000", fixed_net_weight: "" }),
  );
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.weight, "N/A");
});

test("pluOnly mode: raw item barcode, code128, no checkdigit", () => {
  const out = makeLabelData(baseInput({ barcodeMode: "pluOnly" }));
  if (typeof out === "string") return assert.fail(out);
  assert.equal(out.barcode, "0200123");
  assert.equal(out.barcodeFormat, "code128");
  assert.equal(out.barcodeWithCheckDigit, null);
});

test("error strings preserved from the legacy implementation, in legacy order", () => {
  assert.equal(
    makeLabelData(baseInput({ prices: [0], promoPrices: null })),
    "Invalid unit price",
  );
  // With a shelf price of 0 a promo alone does not form a price (lowest-of) —
  // the legacy implementation adopted the promo as the unit price here.
  assert.equal(
    makeLabelData(baseInput({ prices: null, promoPrices: [1500] })),
    "Invalid unit price",
  );
  assert.equal(
    makeLabelData(baseInput({ weight: "00000" })),
    "Weight Item requires weight",
  );
  assert.equal(
    makeLabelData(baseInput({ barcode: "123456" })),
    "Weight Item requires 7 digits barcode",
  );
});

test("total ≥ $1000 overflows the 5-digit embedded price → Invalid barcode (legacy cap)", () => {
  const out = makeLabelData(
    baseInput({ is_weight: false, weight: "00000", prices: [100000] }),
  );
  assert.equal(out, "Invalid barcode");
  // $999.00 still fits in five digits.
  const ok = makeLabelData(
    baseInput({ is_weight: false, weight: "00000", prices: [99900] }),
  );
  assert.notEqual(typeof ok, "string");
});

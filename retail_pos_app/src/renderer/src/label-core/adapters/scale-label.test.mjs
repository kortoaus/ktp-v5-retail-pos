// npm run test:label-core
//
// The `/scale` station's contract with the two scale templates: which state
// field lands in which cell, which barcode column feeds which lane, and the two
// rules that have bitten before — markdown must reach the 1D embedded price,
// and must never reach the PP `02`/`03` arrays.

import assert from "node:assert/strict";
import test from "node:test";

import {
  addDaysIso,
  buildScaleLabelData,
  buildScalePPPayload,
  embeddedPriceBarcode,
  fixedWeightText,
  formatLabelDate,
  isWeighedItem,
  labelUnit,
  markdownNameTag,
  ppPayloadBarcode,
  scaleBarcodeFor,
  toIngredientLabel58100Input,
  toScaleLabel6040Input,
} from "./scale-label.ts";
import { buildScaleLabel6040 } from "../templates/scale-6040.ts";
import { buildIngredientLabel58100 } from "../templates/ingredient-58100.ts";
import { renderLabel } from "../zpl.ts";
import { parsePPBarcode } from "../../libs/pp-barcode.ts";

const ITEM = {
  name_en: "Salmon Sashimi",
  name_ko: "연어 사시미",
  uom: "kg",
  barcode: "9300001028165",
  barcodeGTIN: null,
  barcodePLU: "0200123",
  brand: null,
  price: { prices: [2599, 2399, 2199, 1999, 1899] },
  promoPrice: null,
  scaleData: {
    itemId: 1,
    fixedWeightString: null,
    usedBy: 2,
    isFixedWeight: false,
    ingredients: "Salmon, Salt.",
  },
};

const STATE = {
  item: ITEM,
  weight: "01036",
  prices: [2599, 2399, 2199, 1999, 1899],
  promoPrices: null,
  markdown: null,
  packedOnIso: "2026-08-26",
  usedByOffsetDays: 2,
};

const state = (over = {}) => ({ ...STATE, ...over });
const withItem = (over) => state({ item: { ...ITEM, ...over } });

/** `buildScaleLabelData` returns a reason string on failure — fail loudly. */
function labelOf(s) {
  const label = buildScaleLabelData(s);
  if (typeof label === "string") assert.fail(`expected label data, got: ${label}`);
  return label;
}

// ── dates ──────────────────────────────────────────────────────────────────

test("addDaysIso: calendar arithmetic, zone-independent", () => {
  assert.equal(addDaysIso("2026-08-26", 1), "2026-08-27");
  assert.equal(addDaysIso("2026-08-26", 0), "2026-08-26");
  assert.equal(addDaysIso("2026-08-26", -1), "2026-08-25");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysIso("2026-01-01", -1), "2025-12-31");
  // Sydney leaves DST on 05/04/2026 — a naive local-time add loses a day here.
  assert.equal(addDaysIso("2026-04-04", 1), "2026-04-05");
  assert.equal(addDaysIso("2026-10-03", 1), "2026-10-04");
  // Leap day.
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
});

test("addDaysIso / formatLabelDate: malformed input passes through", () => {
  assert.equal(addDaysIso("not-a-date", 1), "not-a-date");
  assert.equal(formatLabelDate("not-a-date"), "not-a-date");
  assert.equal(formatLabelDate("2026-13-01"), "2026-13-01");
});

test("formatLabelDate: display only, `D MMM YY`", () => {
  assert.equal(formatLabelDate("2026-08-26"), "26 Aug 26");
  assert.equal(formatLabelDate("2026-01-01"), "1 Jan 26");
});

// ── item fields ────────────────────────────────────────────────────────────

test("isWeighedItem: fixed-weight and scale-data-less items are not weighed", () => {
  assert.equal(isWeighedItem(ITEM), true);
  assert.equal(
    isWeighedItem({ ...ITEM, scaleData: { ...ITEM.scaleData, isFixedWeight: true } }),
    false,
  );
  assert.equal(isWeighedItem({ ...ITEM, scaleData: null }), false);
});

test("fixedWeightText: catalogue string wins, else `1 <UOM>`", () => {
  assert.equal(
    fixedWeightText({ ...ITEM, scaleData: { ...ITEM.scaleData, fixedWeightString: "500g" } }),
    "500g",
  );
  assert.equal(fixedWeightText({ ...ITEM, scaleData: null, uom: "ea" }), "1 EA");
  assert.equal(fixedWeightText({ ...ITEM, scaleData: null, uom: "" }), "1 EA");
});

test("labelUnit: a weighed item is always kg, whatever the catalogue says", () => {
  assert.equal(labelUnit({ ...ITEM, uom: "ea" }), "kg");
  assert.equal(
    labelUnit({
      ...ITEM,
      uom: "ea",
      scaleData: { ...ITEM.scaleData, isFixedWeight: true },
    }),
    "ea",
  );
});

test("the two barcode columns feed different lanes", () => {
  // 1D embeds the price after the 7-digit PLU.
  assert.equal(embeddedPriceBarcode(ITEM), "0200123");
  assert.equal(embeddedPriceBarcode({ ...ITEM, barcodePLU: null }), "9300001028165");
  // 2D field 01 goes widest-first, matching the server's resolver order.
  assert.equal(ppPayloadBarcode(ITEM), "0200123");
  assert.equal(
    ppPayloadBarcode({ ...ITEM, barcodeGTIN: "09300001028165" }),
    "09300001028165",
  );
  assert.equal(
    ppPayloadBarcode({ ...ITEM, barcodeGTIN: null, barcodePLU: null }),
    "9300001028165",
  );
});

// ── markdown name tag ──────────────────────────────────────────────────────

test("markdownNameTag: the legacy `[30% OFF] ` convention, built by the adapter", () => {
  assert.equal(markdownNameTag(null), "");
  assert.equal(markdownNameTag({ type: "pct", value: 0 }), "");
  assert.equal(markdownNameTag({ type: "pct", value: 300 }), "[30% OFF] ");
  assert.equal(markdownNameTag({ type: "pct", value: 305 }), "[30.5% OFF] ");
  assert.equal(markdownNameTag({ type: "amt", value: 100 }), "[$1.00 OFF] ");
  assert.equal(markdownNameTag({ type: "amt", value: 50 }), "[$0.50 OFF] ");
});

// ── label data ─────────────────────────────────────────────────────────────

test("buildScaleLabelData: weighed item, level arrays, Sydney dates", () => {
  const label = labelOf(state());
  assert.equal(label.unitPrice, "25.99");
  assert.equal(label.totalPrice, "26.93"); // 25.99 × 1.036, rounded once
  assert.equal(label.weight, "1.036");
  assert.equal(label.unit, "kg");
  assert.equal(label.barcode, "020012302693");
  assert.equal(label.packedOnIso, "2026-08-26");
  assert.equal(label.usedByOffsetDays, 2);
  assert.equal(label.ingredients, "Salmon, Salt.");
});

test("buildScaleLabelData: reason strings reach the caller, not an exception", () => {
  assert.equal(buildScaleLabelData(state({ weight: "00000" })), "Weight Item requires weight");
  assert.equal(buildScaleLabelData(state({ prices: [0] })), "Invalid unit price");
  // No 7-digit PLU and a 13-digit barcode: the 1D lane cannot be formed, and
  // this build is shared, so the 2D lane is blocked too. Deliberate — see the
  // adapter's `buildScaleLabelData` doc.
  assert.equal(
    buildScaleLabelData(withItem({ barcodePLU: null })),
    "Weight Item requires 7 digits barcode",
  );
});

// ── the two rules that have bitten before ──────────────────────────────────

test("MARKDOWN REACHES THE 1D EMBEDDED PRICE (the legacy 1D bug)", () => {
  // The retired scale app's 1D path did not know about markdown, so a
  // marked-down label rang up the pre-markdown amount at the till.
  const label = labelOf(state({ markdown: { type: "pct", value: 300 } }));
  assert.equal(label.totalPrice, "18.85"); // 2693 × 0.7 → 1885
  assert.equal(label.wasTotalPrice, "26.93");
  assert.equal(label.barcode, "020012301885");
  assert.equal(label.barcode.slice(7, 12), "01885"); // the till's read window

  const input = toScaleLabel6040Input(state({ markdown: { type: "pct", value: 300 } }), label, "1d");
  assert.equal(input.totalText, "$18.85");
  assert.equal(input.wasTotalText, "$26.93");
  assert.equal(input.barcode.data12, "020012301885");
  // …and the name announces it, the way the legacy stock expects.
  assert.equal(input.nameEn, "[30% OFF] Salmon Sashimi");
});

test("ANTI-DOUBLE-DISCOUNT: PP 02/03 stay unfolded; markdown rides only in 05/06", () => {
  const s = state({
    promoPrices: [1999, 0, 0, 0, 0],
    markdown: { type: "pct", value: 300 },
  });
  const label = labelOf(s);
  const pp = parsePPBarcode(buildScalePPPayload(s, label));

  assert.deepEqual(pp.prices, [2599, 2399, 2199, 1999, 1899]);
  assert.deepEqual(pp.promoPrices, [1999, 0, 0, 0, 0]);
  assert.equal(pp.discountType, "pct");
  assert.equal(pp.discountAmount, 300);
  // 07 is ISO, 08 is a whole-day offset.
  assert.equal(pp.packedOn, "2026-08-26");
  assert.equal(pp.usedBy, 2);
  assert.equal(pp.barcode, "0200123");
  assert.equal(pp.weight, 1036);
});

test("PP payload: a fixed-weight item carries no 04 weight", () => {
  const s = state({
    item: { ...ITEM, scaleData: { ...ITEM.scaleData, isFixedWeight: true } },
    weight: "00000",
  });
  const pp = parsePPBarcode(buildScalePPPayload(s, labelOf(s)));
  assert.equal(pp.weight, null);
});

test("PP payload: no markdown means no 05/06 at all", () => {
  const s = state();
  const pp = parsePPBarcode(buildScalePPPayload(s, labelOf(s)));
  assert.equal(pp.discountType, null);
  assert.equal(pp.discountAmount, 0);
});

// ── template inputs ────────────────────────────────────────────────────────

test("toScaleLabel6040Input: full field mapping, 1D lane", () => {
  const s = state({ promoPrices: [1999, 0, 0, 0, 0] });
  const label = labelOf(s);
  const input = toScaleLabel6040Input(s, label, "1d", {
    name: "DREAM MARKET",
    address: "42-50 Rowe St. Eastwood NSW 2122",
  });

  assert.equal(input.nameEn, "Salmon Sashimi");
  assert.equal(input.nameKo, "연어 사시미");
  assert.equal(input.packedOnIso, "2026-08-26");
  assert.equal(input.usedByIso, "2026-08-28"); // packed + scaleData.usedBy
  assert.equal(input.weightText, "1.036");
  assert.equal(input.unit, "kg");
  // Money carries `$`: the 60 × 40 prints unitPriceText verbatim, and every
  // other money field runs through `amountOnly`, which strips it.
  assert.equal(input.unitPriceText, "$19.99");
  assert.equal(input.wasUnitPriceText, "$25.99");
  assert.equal(input.totalText, "$20.71");
  assert.equal(input.wasTotalText, null);
  assert.deepEqual(input.barcode, { kind: "ean13", data12: "020012302071" });
  assert.equal(input.storeName, "DREAM MARKET");
  assert.equal(input.storeAddress, "42-50 Rowe St. Eastwood NSW 2122");
});

test("toScaleLabel6040Input: brand prefixes the name, as itemLabelNames does", () => {
  const s = withItem({ brand: { name_en: "DS", name_ko: "디에스" } });
  const input = toScaleLabel6040Input(s, labelOf(s), "1d");
  assert.equal(input.nameEn, "[DS] Salmon Sashimi");
  assert.equal(input.nameKo, "[디에스] 연어 사시미");
});

test("toScaleLabel6040Input: the 2D lane swaps only the symbol", () => {
  const s = state();
  const label = labelOf(s);
  const oneD = toScaleLabel6040Input(s, label, "1d");
  const twoD = toScaleLabel6040Input(s, label, "2d");

  assert.equal(twoD.barcode.kind, "pp");
  assert.ok(twoD.barcode.qrData.startsWith("00:"));
  // Everything else identical.
  assert.deepEqual({ ...oneD, barcode: null }, { ...twoD, barcode: null });
});

test("toIngredientLabel58100Input: adds the statement, drops the store block", () => {
  const s = state();
  const input = toIngredientLabel58100Input(s, labelOf(s), "2d");
  assert.equal(input.ingredients, "Salmon, Salt.");
  // The 58 × 100 stock pre-prints the store in its header and footer.
  assert.equal(input.storeName, null);
  assert.equal(input.storeAddress, null);
  assert.equal(input.barcode.kind, "pp");
});

test("toIngredientLabel58100Input: an item with no statement passes null, not ''", () => {
  const s = withItem({ scaleData: { ...ITEM.scaleData, ingredients: null } });
  assert.equal(toIngredientLabel58100Input(s, labelOf(s), "1d").ingredients, null);
});

test("scaleBarcodeFor: lane picks the symbol and nothing else", () => {
  const s = state();
  const label = labelOf(s);
  assert.equal(scaleBarcodeFor("1d", s, label).kind, "ean13");
  assert.equal(scaleBarcodeFor("2d", s, label).kind, "pp");
});

// ── end to end ─────────────────────────────────────────────────────────────

test("all four lanes render to ZPL without throwing", () => {
  const s = state({ markdown: { type: "amt", value: 200 } });
  const label = labelOf(s);

  const jobs = [
    renderLabel(buildScaleLabel6040(toScaleLabel6040Input(s, label, "1d", { name: "DM" }))),
    renderLabel(buildIngredientLabel58100(toIngredientLabel58100Input(s, label, "1d"))),
    renderLabel(buildScaleLabel6040(toScaleLabel6040Input(s, label, "2d", { name: "DM" }))),
    renderLabel(buildIngredientLabel58100(toIngredientLabel58100Input(s, label, "2d"))),
  ];

  for (const zpl of jobs) {
    assert.ok(zpl.startsWith("^XA"));
    assert.ok(zpl.trimEnd().endsWith("^XZ"));
  }
  // 1D carries an EAN, 2D a QR — the lane really did change the symbol.
  assert.ok(jobs[0].includes("^BE"));
  assert.ok(jobs[2].includes("^BQ"));
});

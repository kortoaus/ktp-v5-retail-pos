// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceTag7030, formatMoney } from "./price-tag-7030.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

const SAMPLE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  uom: "kg",
  priceCents: 5500,
  wasPriceCents: 6200,
  promoRange: "26/08 - 27/08",
  barcode: "9300001028165",
};

test("cents in, dollars out", () => {
  assert.equal(formatMoney(5500), "$55.00");
  assert.equal(formatMoney(5), "$0.05");
  assert.equal(formatMoney(129999), "$1299.99");
});

test("the price is four fields, big dollars in Black", () => {
  const zpl = renderLabel(buildPriceTag7030(SAMPLE));

  assert.ok(zpl.includes("^PW560") && zpl.includes("^LL240"));
  assert.ok(zpl.includes("^FO5,20^A@N,41,37,E:NOTOKRB.TTF^FH^FD$^FS"), zpl);
  assert.ok(zpl.includes("^FO35,10^A@N,61,55,E:NOTOKRBK.TTF^FH^FD55^FS"), zpl);
  // dot and cents follow by measured advance, not by a per-digit constant
  const dot = /\^FO(\d+),15\^A@N,41,37,E:NOTOKRB\.TTF\^FH\^FD\.\^FS/.exec(zpl);
  const cents = /\^FO(\d+),15\^A@N,41,37,E:NOTOKRB\.TTF\^FH\^FD00\^FS/.exec(zpl);
  assert.ok(dot && cents, zpl);
  assert.ok(Number(dot[1]) > 35, "the dot sits after the dollars");
  assert.ok(Number(cents[1]) > Number(dot[1]), "the cents sit after the dot");
  assert.ok(zpl.includes("^FD/kg^FS"), "the unit rides beside the price");
});

test("the Data Matrix stays where the old tag put it", () => {
  const zpl = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(zpl.includes("^FO350,10^BXN,4,200^FH^FD9300001028165^FS"), zpl);
});

test("the was-price and its date range share one line", () => {
  const withRange = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(withRange.includes("^FDwas $62.00  26/08 - 27/08^FS"), withRange);

  const noRange = renderLabel(buildPriceTag7030({ ...SAMPLE, promoRange: null }));
  assert.ok(noRange.includes("^FDwas $62.00^FS"));

  const noPromo = renderLabel(buildPriceTag7030({ ...SAMPLE, wasPriceCents: null }));
  assert.ok(!noPromo.includes("was $"));
  // …and the rows move up a line when it is gone.
  assert.ok(noPromo.includes("^FO10,90^A@N,21,19,E:NOTOKRB.TTF"), noPromo);
});

test("Korean name Bold, English Medium and at most two lines", () => {
  const label = buildPriceTag7030(SAMPLE);
  const ko = label.elements.find((el) => el.kind === "text" && el.text === SAMPLE.nameKo);
  const en = label.elements.find((el) => el.kind === "text" && el.text === SAMPLE.nameEn);

  assert.equal(ko.weight, "B");
  assert.equal(en.weight, "M");
  assert.ok(en.lines <= 2, `${en.lines} lines`);

  const long = buildPriceTag7030({
    ...SAMPLE,
    nameEn: "Assorted Sashimi Platter Deluxe With Extra Wasabi And Ginger",
  });
  const longEn = long.elements.find((el) => el.kind === "text" && el.lines === 2);
  assert.ok(longEn, "a long English name wraps to its two-line cap");
});

test("nothing lands outside 560 × 240", () => {
  const [pageW, pageH] = MEDIA["7030"].dots;
  const inputs = [
    SAMPLE,
    { ...SAMPLE, wasPriceCents: null, promoRange: null },
    { ...SAMPLE, priceCents: 129999, uom: "100g", barcode: "  " },
    {
      ...SAMPLE,
      nameEn: "Assorted Sashimi Platter Deluxe With Extra Wasabi And Ginger",
    },
  ];
  for (const input of inputs) {
    for (const el of buildPriceTag7030(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("dbg rides through", () => {
  assert.equal(buildPriceTag7030(SAMPLE, { dbg: true }).dbg, true);
});

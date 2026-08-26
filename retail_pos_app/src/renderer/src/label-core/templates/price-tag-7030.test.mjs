// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { PRINTABLE_W, buildPriceTag7030, formatMoney } from "./price-tag-7030.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel, resolveTextSize } from "../zpl.ts";

const SAMPLE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  uom: "kg",
  priceCents: 5500,
  wasPriceCents: 6200,
  promoRange: "26/08 - 27/08",
  barcode: "9300001028165",
};

const LONG_KO = "[농심] 긴 이름 엄청 긴 이름 아이템 123.5pk";
const LONG_EN = "[Nongshim] Long Long Name Long Long Name Long 123*5 pk";

/**
 * The shapes the tag has to survive — the same set `print-templates.mjs`
 * renders, so a coordinate that moves here is a coordinate somebody can look at
 * on real stock.
 */
const INPUTS = {
  promo: SAMPLE,
  normal: { ...SAMPLE, wasPriceCents: null, promoRange: null },
  "long name": { ...SAMPLE, nameKo: LONG_KO, nameEn: LONG_EN },
  discount: {
    ...SAMPLE,
    priceCents: 1999,
    wasPriceCents: 2599,
    promoRange: "6th-31st May 26",
  },
  "4-digit price": { ...SAMPLE, priceCents: 123400, uom: "100g", barcode: "  " },
};

/**
 * The bottom the hardware photo showed as safe.
 *
 * A 30 mm web does not feed straight enough to trust the last 40 dots; the
 * first cut's footer at y 205…225 printed clipped.
 */
const SAFE_BOTTOM = 200;

const texts = (label) => label.elements.filter((el) => el.kind === "text");
const byText = (label, text) => texts(label).find((el) => el.text === text);
/** The big Black field — the dollars, whatever size they ended up at. */
const dollarsOf = (label) => texts(label).find((el) => el.weight === "BK");
const dmOf = (label) => label.elements.find((el) => el.kind === "datamatrix");

test("cents in, dollars out", () => {
  assert.equal(formatMoney(5500), "$55.00");
  assert.equal(formatMoney(5), "$0.05");
  assert.equal(formatMoney(129999), "$1299.99");
});

test("the media header is unchanged — 560 × 240 is still what the printer feeds", () => {
  const zpl = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(zpl.startsWith("^XA\n^CI28\n^PW560\n^LL240\n^LH0,0\n"), zpl);
  // …and the artwork ceiling is narrower than the media, on purpose: the red
  // tear-off arrow and its dashed tear line own the last 110 dots.
  assert.equal(PRINTABLE_W, 450);
  assert.ok(PRINTABLE_W < MEDIA["7030"].dots[0]);
});

test("the price is four fields: raised $, huge dollars, raised cents, raised unit", () => {
  const zpl = renderLabel(buildPriceTag7030(SAMPLE));

  assert.ok(zpl.includes("^FO18,20^A@N,42,38,E:NOTOKRB.TTF^FH^FD$^FS"), zpl);
  assert.ok(zpl.includes("^FO46,8^A@N,96,86,E:NOTOKRBK.TTF^FH^FD55^FS"), zpl);
  // cents and unit follow by measured advance, not by a per-digit constant
  const cents = /\^FO(\d+),17\^A@N,46,41,E:NOTOKRB\.TTF\^FH\^FD00\^FS/.exec(zpl);
  const uom = /\^FO(\d+),19\^A@N,24,22,E:NOTOKRM\.TTF\^FH\^FD\/kg\^FS/.exec(zpl);
  assert.ok(cents && uom, zpl);
  assert.ok(Number(cents[1]) > 46 + 112, "the cents sit after the dollars");
  assert.ok(Number(uom[1]) > Number(cents[1]), "the unit sits after the cents");

  const label = buildPriceTag7030(SAMPLE);
  const dollars = elementBounds(dollarsOf(label));
  const sign = elementBounds(byText(label, "$"));
  const cent = elementBounds(byText(label, "00"));
  const unit = elementBounds(byText(label, "/kg"));

  // "raised" = the small fields hang in the dollars' upper half, not on its baseline
  assert.ok(sign.y > dollars.y && sign.y + sign.h < dollars.y + dollars.h, "$ is raised");
  assert.ok(cent.y > dollars.y && cent.y + cent.h < dollars.y + dollars.h, "cents are raised");
  // the unit rides the cents' cap line rather than the dollars' baseline
  assert.ok(
    Math.abs(unit.y - cent.y) <= 4,
    `unit top ${unit.y} is not level with the cents' ${cent.y}`,
  );
  assert.ok(unit.y + unit.h < dollars.y + dollars.h, "the unit clears the dollars' baseline");

  // the whole price block lives in the top ~105 dots
  assert.equal(dollars.y, 8);
  assert.ok(dollars.y + dollars.h <= 106, `price block bottom ${dollars.y + dollars.h}`);
});

test("nothing lands outside the 450 × 240 printable area", () => {
  const pageH = MEDIA["7030"].dots[1];

  for (const [name, input] of Object.entries(INPUTS)) {
    for (const el of buildPriceTag7030(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${name}: ${el.kind} starts on the label`);
      assert.ok(
        box.x + box.w <= PRINTABLE_W,
        `${name}: ${el.kind} right edge ${box.x + box.w} > ${PRINTABLE_W}`,
      );
      assert.ok(box.y + box.h <= pageH, `${name}: ${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("nothing reaches the bottom edge the printer clips", () => {
  for (const [name, input] of Object.entries(INPUTS)) {
    for (const el of buildPriceTag7030(input).elements) {
      const box = elementBounds(el);
      assert.ok(
        box.y + box.h <= SAFE_BOTTOM,
        `${name}: ${el.kind} bottom ${box.y + box.h} > ${SAFE_BOTTOM}`,
      );
    }
  }
});

test("the price never runs under the Data Matrix", () => {
  for (const [name, input] of Object.entries(INPUTS)) {
    const label = buildPriceTag7030(input);
    const dm = elementBounds(dmOf(label));
    for (const el of texts(label)) {
      const box = elementBounds(el);
      if (box.y >= dm.y + dm.h) continue; // names and footer pass under it
      assert.ok(box.x + box.w <= dm.x, `${name}: "${el.text}" reaches ${box.x + box.w} ≥ ${dm.x}`);
    }
  }
});

test("a four-digit price shrinks rather than collide", () => {
  const normal = dollarsOf(buildPriceTag7030(SAMPLE));
  assert.equal(normal.size, 96);

  // $1234.56 /kg — too wide at full size
  const big = dollarsOf(buildPriceTag7030({ ...SAMPLE, priceCents: 123456 }));
  assert.ok(big.size < normal.size, `four digits still at ${big.size}`);

  // $1234.00 /100g — the widest the tag can be asked for, shrinks further
  const widest = dollarsOf(buildPriceTag7030({ ...SAMPLE, priceCents: 123400, uom: "100g" }));
  assert.ok(widest.size < big.size, `${widest.size} is not smaller than ${big.size}`);
  assert.ok(widest.size >= 64, `shrank past the 64-dot floor to ${widest.size}`);
});

test("Korean name Bold over English Medium, one line each, shrinking to fit", () => {
  const label = buildPriceTag7030(SAMPLE);
  const ko = byText(label, SAMPLE.nameKo);
  const en = byText(label, SAMPLE.nameEn);

  assert.equal(ko.weight, "B");
  assert.equal(en.weight, "M");
  assert.equal(ko.lines, 1);
  assert.equal(en.lines, 1);
  assert.equal(resolveTextSize(ko), 34);
  assert.equal(resolveTextSize(en), 24);

  const price = elementBounds(dollarsOf(label));
  assert.ok(ko.y >= price.y + price.h, "the Korean name clears the price cell");
  assert.ok(en.y > ko.y, "Korean first, English under it");
});

test("a long name shrinks and stays inside the printable width", () => {
  const label = buildPriceTag7030({ ...SAMPLE, nameKo: LONG_KO, nameEn: LONG_EN });
  const ko = byText(label, LONG_KO);
  const en = byText(label, LONG_EN);

  assert.equal(ko.lines, 1, "a long Korean name shrinks, it does not wrap");
  assert.equal(en.lines, 1);
  assert.ok(resolveTextSize(ko) < 34 && resolveTextSize(ko) >= 24, "Korean floor is 24");
  assert.ok(resolveTextSize(en) < 24 && resolveTextSize(en) >= 18, "English floor is 18");

  for (const el of [ko, en]) {
    const box = elementBounds(el);
    assert.equal(box.x + box.w, PRINTABLE_W - 8, "the block still stops at the margin");
  }
});

test("the Data Matrix sits top-right, clear of the tear line", () => {
  const zpl = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(zpl.includes("^FO362,8^BXN,5,200^FH^FD9300001028165^FS"), zpl);

  const dm = elementBounds(dmOf(buildPriceTag7030(SAMPLE)));
  assert.equal(dm.x + dm.w, PRINTABLE_W - 8, "8 dots of margin, then the tear-off arrow");
  assert.equal(dm.y, 8);

  // a blank barcode still encodes something scannable-shaped
  const blank = renderLabel(buildPriceTag7030({ ...SAMPLE, barcode: "  " }));
  assert.ok(blank.includes("^FO362,8^BXN,5,200^FH^FD-^FS"), blank);
});

test("the barcode digits are right-aligned to 442, was-price or not", () => {
  const digits = "^FO282,178^A@N,20,18,E:NOTOKRM.TTF^FB160,1,0,R,0^FH^FD9300001028165^FS";

  const promo = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(promo.includes(digits), promo);

  const noPromo = renderLabel(buildPriceTag7030({ ...SAMPLE, wasPriceCents: null }));
  assert.ok(noPromo.includes(digits), "the digits do not move when the was-price is gone");

  const el = byText(buildPriceTag7030(SAMPLE), SAMPLE.barcode);
  const box = elementBounds(el);
  assert.equal(el.align, "R");
  assert.equal(box.x + box.w, PRINTABLE_W - 8);
});

test("the was-price and its date range share the footer's left half", () => {
  const withRange = renderLabel(buildPriceTag7030(SAMPLE));
  assert.ok(withRange.includes("^FDwas $62.00  26/08 - 27/08^FS"), withRange);

  const noRange = renderLabel(buildPriceTag7030({ ...SAMPLE, promoRange: null }));
  assert.ok(noRange.includes("^FDwas $62.00^FS"));

  const noPromo = renderLabel(buildPriceTag7030({ ...SAMPLE, wasPriceCents: null }));
  assert.ok(!noPromo.includes("was $"));

  // a "was" that is not higher than what is charged is not a promotion
  const notPromo = renderLabel(buildPriceTag7030({ ...SAMPLE, wasPriceCents: 5500 }));
  assert.ok(!notPromo.includes("was $"));

  const label = buildPriceTag7030(SAMPLE);
  const was = byText(label, "was $62.00  26/08 - 27/08");
  const digits = byText(label, SAMPLE.barcode);
  assert.equal(was.y, digits.y, "one footer row");
  assert.ok(
    elementBounds(was).x + elementBounds(was).w <= elementBounds(digits).x,
    "the was-price stops before the digits",
  );
});

test("the discount tag's long date range still fits its half of the footer", () => {
  const label = buildPriceTag7030(INPUTS.discount);
  const was = byText(label, "was $25.99  6th-31st May 26");
  const digits = byText(label, SAMPLE.barcode);
  assert.ok(was, "the was-price line is built");

  // it is wider than the block, so it shrinks rather than run into the digits
  assert.ok(resolveTextSize(was) < 20, `was line still at ${resolveTextSize(was)}`);
  assert.ok(resolveTextSize(was) >= 14, "the 14-dot footer floor holds");

  const wasBox = elementBounds(was);
  const digitsBox = elementBounds(digits);
  assert.ok(wasBox.x + wasBox.w <= digitsBox.x, "the was-price stops before the digits");
  assert.ok(wasBox.y + wasBox.h <= SAFE_BOTTOM && digitsBox.y + digitsBox.h <= SAFE_BOTTOM);
});

test("dbg rides through", () => {
  assert.equal(buildPriceTag7030(SAMPLE, { dbg: true }).dbg, true);
});

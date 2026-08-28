// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildIngredientLabel58100 } from "./ingredient-58100.ts";
import { MEDIA } from "../media.ts";
import { textWidth } from "../measure.ts";
import { elementBounds, renderLabel, resolveTextSize } from "../zpl.ts";
import { buildPPBarcodeString } from "../../libs/pp-barcode.ts";

/**
 * The statement panel the owner signed off — allergen line included, because
 * the allergen sentence is what makes a real one long enough to test the
 * five-line cap against.
 */
const INGREDIENTS =
  "Salmon (Atlantic, farmed), Salt. Allergen information: Contains fish. " +
  "Keep refrigerated below 4C. Consume on day of purchase.";

/**
 * The PP payload built the way the screen builds it, on the real POS item PLU,
 * with the 30% markdown the sample label carries. Same builder, same five price
 * levels and five promo levels as the 60 × 40 sample.
 */
const PP_QR = buildPPBarcodeString({
  barcode: "0213436",
  prices: [6200, 5900, 5700, 5500, 5300],
  promoPrices: [5500, 5300, 5100, 4900, 4700],
  weight: 512,
  discountType: "pct",
  discountAmount: 300,
  packedOn: "2026-08-26",
  usedBy: 1,
});

const SAMPLE = {
  /** Carried by the shared input, never printed on this label. */
  nameKo: "DS 연어 사시미 (호주산)",
  nameEn: "DS Salmon Sashimi (A)",
  packedOnIso: "2026-08-26",
  usedByIso: "2026-08-27",
  weightText: "0.512",
  unit: "kg",
  unitPriceText: "$55.00",
  wasUnitPriceText: "$62.00",
  totalText: "$28.16",
  /** Also carried and never printed — the yellow header/footer say both. */
  storeName: "DREAM MARKET",
  storeAddress: "42-50 Rowe St. Eastwood NSW 2122",
  ingredients: INGREDIENTS,
};

/** The mockup's own case: a 30% markdown, so both `was` columns print. */
const TWO_D = {
  ...SAMPLE,
  nameEn: "[30% OFF] DS Salmon Sashimi (A)",
  totalText: "$19.71",
  wasTotalText: "$28.16",
  barcode: { kind: "pp", qrData: PP_QR },
};

const ONE_D = { ...SAMPLE, barcode: { kind: "ean13", data12: "200000102816" } };

/** The pre-printed artwork the values have to land in (dots, 203 dpi). */
const STOCK = {
  header: { y1: 115 },
  captionRow: 480,
  boxes: {
    net: { x0: 37, x1: 131 },
    unitPrice: { x0: 150, x1: 253 },
    totalPrice: { x0: 272, x1: 404 },
    y0: 517,
    y1: 540,
  },
  rule: 606,
  footer: { y0: 735 },
};

/**
 * `docs/label-mockups/58100-pre-2d.zpl`, line for line — except the two lines
 * noted below, which the library derives where the hand ZPL guessed.
 */
const MOCKUP = [
  `^FO20,212^A@N,18,16,E:NOTOKRM.TTF^FB424,5,0,L,0^FH^FD${INGREDIENTS}^FS`,
  `^FT310,440^BQN,2,3^FH^FDLA,${PP_QR}^FS`,
  "^FO150,450^A@N,26,23,E:NOTOKRBK.TTF^FH^FDwas 62.00^FS",
  "^FO300,450^A@N,26,23,E:NOTOKRBK.TTF^FH^FDwas 28.16^FS",
  "^FO37,562^A@N,34,31,E:NOTOKRB.TTF^FB94,1,0,C,0^FH^FD0.512^FS",
  "^FO150,562^A@N,34,31,E:NOTOKRB.TTF^FB103,1,0,C,0^FH^FD55.00^FS",
  "^FO272,556^A@N,44,40,E:NOTOKRBK.TTF^FB132,1,0,C,0^FH^FD19.71^FS",
  "^FO33,660^A@N,24,22,E:NOTOKRB.TTF^FB100,1,0,L,0^FH^FD26/08^FS",
  "^FO155,660^A@N,24,22,E:NOTOKRB.TTF^FB100,1,0,L,0^FH^FD27/08^FS",
];

test("the 2D label reproduces the confirmed mockup, element for element", () => {
  const zpl = renderLabel(buildIngredientLabel58100(TWO_D));

  assert.ok(zpl.includes("^PW464") && zpl.includes("^LL800"));
  for (const line of MOCKUP) assert.ok(zpl.includes(line), `missing: ${line}`);
});

/**
 * Two lines of the hand ZPL the library deliberately does not copy.
 *
 * Both are the same call the 60 × 40 template already makes: a number the owner
 * eyeballed on stock is replaced by one this library measures, so it stays right
 * for names and prices the mockup never contained.
 */
test("the name is sized by measurement, not by the mockup's hand-picked 34", () => {
  const zpl = renderLabel(buildIngredientLabel58100(TWO_D));

  // The mockup writes `^A@N,34,31` for this name. It measures 561 dots at 34
  // against a 424-dot block, so the rule puts it on two lines at 26.
  assert.ok(
    zpl.includes(
      "^FO20,128^A@N,26,23,E:NOTOKRB.TTF^FB424,2,0,L,0^FH^FD[30% OFF] DS Salmon Sashimi (A)^FS",
    ),
    zpl,
  );
  assert.ok(!zpl.includes("^A@N,34,31,E:NOTOKRB.TTF^FB424,2"), "34 would overflow the band");
});

test("the was rules are measured from the text, not the mockup's hand width", () => {
  const zpl = renderLabel(buildIngredientLabel58100(TWO_D));

  // `was 62.00` and `was 28.16` measure the same 126 dots at 26, and the rule
  // starts two dots left of the glyphs so it reads as a strike-through.
  assert.ok(zpl.includes("^FO148,463^GB126,2,2^FS"), zpl);
  assert.ok(zpl.includes("^FO298,463^GB126,2,2^FS"), zpl);

  // A shorter was-price gets a shorter rule; a hand-drawn width would not move.
  const short = buildIngredientLabel58100({ ...TWO_D, wasUnitPriceText: "$5.00" });
  const [rule] = short.elements.filter((el) => el.kind === "line" && el.x === 148);
  assert.ok(rule.w < 126, `${rule.w} < 126`);
});

test("the was lines are Black 26 without a dollar sign, above the caption row", () => {
  const label = buildIngredientLabel58100(TWO_D);
  const was = label.elements.filter((el) => el.kind === "text" && el.text.startsWith("was "));

  assert.equal(was.length, 2, "unit price and total both marked down");
  for (const el of was) {
    assert.equal(el.size, 26);
    assert.equal(el.weight, "BK");
    assert.ok(!el.text.includes("$"), `${el.text} — the stock prints the $`);
    assert.equal(el.width, undefined, "no block width: the line is as wide as it prints");
    const box = elementBounds(el);
    assert.ok(box.y + box.h <= STOCK.boxes.y0, "the was row stops above the caption boxes");
  }
  assert.deepEqual(was.map((el) => el.x).sort((a, b) => a - b), [150, 300]);
});

test("each was line is optional and independent", () => {
  const none = renderLabel(
    buildIngredientLabel58100({ ...TWO_D, wasUnitPriceText: null, wasTotalText: null }),
  );
  assert.ok(!none.includes("was "), none);
  assert.ok(!none.includes("^GB"), "no rule without a was-price");

  const unitOnly = renderLabel(buildIngredientLabel58100({ ...TWO_D, wasTotalText: null }));
  assert.ok(unitOnly.includes("was 62.00") && !unitOnly.includes("was 28.16"));

  const totalOnly = renderLabel(buildIngredientLabel58100({ ...TWO_D, wasUnitPriceText: null }));
  assert.ok(totalOnly.includes("was 28.16") && !totalOnly.includes("was 62.00"));
});

test("nothing the stock already prints is printed again", () => {
  const zpl = renderLabel(buildIngredientLabel58100(TWO_D));

  for (const caption of [
    "NET WEIGHT",
    "UNIT PRICE",
    "TOTAL PRICE",
    "PACKED ON",
    "USE BY",
    "$/KG",
    "kg",
    "DREAM MARKET",
    "Rowe St",
    "연어",
  ]) {
    assert.ok(!zpl.includes(caption), `${caption} is on the stock (or not this label's)`);
  }

  // Both money columns lose their `$` — the caption row prints one over each.
  assert.ok(zpl.includes("^FH^FD55.00^FS") && !zpl.includes("^FH^FD$55.00^FS"));
  assert.ok(zpl.includes("^FH^FD19.71^FS") && !zpl.includes("^FH^FD$19.71^FS"));
});

// ---------------------------------------------------------------------------
// The name band
// ---------------------------------------------------------------------------

test("a name that fits gets one Bold 34 line; a long one gets two at 26", () => {
  const short = renderLabel(buildIngredientLabel58100(ONE_D));
  assert.ok(
    short.includes(
      "^FO20,128^A@N,34,31,E:NOTOKRB.TTF^FB424,2,0,L,0^FH^FDDS Salmon Sashimi (A)^FS",
    ),
    short,
  );

  const long = renderLabel(
    buildIngredientLabel58100({ ...ONE_D, nameEn: "NS Shin Black Big Bowl 101g Premium Pack" }),
  );
  assert.ok(long.includes("^FO20,128^A@N,26,23,E:NOTOKRB.TTF^FB424,2,0,L,0^FH^FDNS Shin"), long);
});

test("the name band is left aligned and always allows the printer two lines", () => {
  for (const nameEn of ["DS Salmon Sashimi (A)", "A".repeat(120)]) {
    const el = buildIngredientLabel58100({ ...ONE_D, nameEn }).elements[0];
    assert.equal(el.align, "L", "the paragraph under it is left aligned too");
    assert.equal(el.lines, 2, "^FB never truncates a name our measure got wrong");
    assert.equal(el.y, 128, "the band's y does not move with the line count");
    assert.ok(el.size >= 20, `never below the floor, got ${el.size}`);
  }
});

test("the name band never reaches into the ingredient block", () => {
  for (const nameEn of ["DS Salmon Sashimi (A)", "A".repeat(400)]) {
    const box = elementBounds(buildIngredientLabel58100({ ...ONE_D, nameEn }).elements[0]);
    assert.ok(box.y >= STOCK.header.y1, `${nameEn} starts under the yellow header`);
    assert.ok(box.y + box.h <= 212, `${nameEn} ends at ${box.y + box.h}, past the statement`);
  }
});

// ---------------------------------------------------------------------------
// The statement panel
// ---------------------------------------------------------------------------

test("the statement is five Medium 18 lines and is never shrunk", () => {
  const el = buildIngredientLabel58100({
    ...ONE_D,
    ingredients: `${INGREDIENTS} ${INGREDIENTS} ${INGREDIENTS}`,
  }).elements[1];

  assert.equal(el.size, 18, "a long statement is truncated by ^FB, not set smaller");
  assert.equal(el.lines, 5);
  assert.equal(el.width, 424);
  assert.equal(el.shrink, undefined);

  const none = buildIngredientLabel58100({ ...ONE_D, ingredients: "  " });
  assert.ok(!renderLabel(none).includes("^FB424,5"), "an empty statement prints nothing");
});

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

test("the 1D variant is an EAN-13 and carries no QR", () => {
  const zpl = renderLabel(buildIngredientLabel58100(ONE_D));

  assert.ok(zpl.includes("^FO24,380^BY2,3,80^BEN,80,Y,N^FH^FD200000102816^FS"), zpl);
  assert.ok(!zpl.includes("^BQN"), "no QR on the 1D variant");
});

test("the 2D variant is a bottom-anchored QR and carries no barcode", () => {
  const zpl = renderLabel(buildIngredientLabel58100(TWO_D));
  assert.ok(!zpl.includes("^BEN"), "no linear barcode on the 2D variant");
  assert.ok(zpl.includes("^FT310,440^BQN,2,3^FH^FDLA,"), zpl);
});

test("the QR's bottom edge is anchored whatever the payload does", () => {
  for (const qrData of [PP_QR, "00:{}", `00:${"x".repeat(300)}`]) {
    const el = buildIngredientLabel58100({ ...SAMPLE, barcode: { kind: "pp", qrData } }).elements.find(
      (e) => e.kind === "qr",
    );
    const box = elementBounds(el);
    assert.equal(box.y + box.h, 440, `bottom edge is anchored, got ${box.y + box.h}`);
    assert.ok(box.y > 302, `top ${box.y} must stay under the statement panel`);
    assert.ok(box.x + box.w <= MEDIA["58100"].dots[0], "and on the media");
  }
});

// ---------------------------------------------------------------------------
// Dates and the unit correction
// ---------------------------------------------------------------------------

test("the dates use the shared same-year rule, not a size of their own", () => {
  const same = renderLabel(buildIngredientLabel58100(ONE_D));
  assert.ok(same.includes("^FH^FD26/08^FS") && same.includes("^FH^FD27/08^FS"));

  const label = buildIngredientLabel58100({
    ...ONE_D,
    packedOnIso: "2026-12-31",
    usedByIso: "2027-01-01",
  });
  const dates = label.elements.filter((el) => el.kind === "text" && el.y === 660);
  assert.deepEqual(dates.map((el) => el.text), ["31/12/26", "01/01/27"]);
  assert.equal(dates[0].size, dates[1].size, "one size, so the row reads as a row");
  assert.ok(dates[0].size < 24, "shrunk to clear the year");
});

test("a kilogram item leaves the pre-printed $/KG caption alone", () => {
  const label = buildIngredientLabel58100(ONE_D);
  assert.ok(!label.elements.some((el) => el.kind === "text" && el.text.startsWith("$/")));
  assert.ok(!renderLabel(label).includes("^FO146,512"), "no rule over the caption");
});

test("an each-priced item strikes the caption and names the real unit", () => {
  const zpl = renderLabel(
    buildIngredientLabel58100({ ...ONE_D, unit: "EA", weightText: "1 EA" }),
  );

  assert.ok(zpl.includes("^FO146,512^GB38,2,2^FS"), zpl);
  assert.ok(zpl.includes("^FO190,500^A@N,20,18,E:NOTOKRB.TTF^FH^FD$/EA^FS"), zpl);
  // The NET WEIGHT box takes the caller's free text verbatim — no unit appended.
  assert.ok(zpl.includes("^FH^FD1 EA^FS"), zpl);

  // Lower case in, upper case out: it has to match the artwork it sits beside.
  const lower = renderLabel(buildIngredientLabel58100({ ...ONE_D, unit: "ea" }));
  assert.ok(lower.includes("^FH^FD$/EA^FS"), lower);
});

// ---------------------------------------------------------------------------
// The media
// ---------------------------------------------------------------------------

test("nothing lands outside 464 × 800, or in the pre-printed footer", () => {
  const [pageW] = MEDIA["58100"].dots;

  for (const input of [
    ONE_D,
    TWO_D,
    { ...ONE_D, unit: "EA", weightText: "1 EA", ingredients: null },
    { ...TWO_D, nameEn: "A".repeat(400), packedOnIso: "2026-12-31", usedByIso: "2027-06-30" },
  ]) {
    for (const el of buildIngredientLabel58100(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(
        box.y + box.h <= STOCK.footer.y0,
        `${el.kind} bottom ${box.y + box.h} runs into the yellow footer at ${STOCK.footer.y0}`,
      );
    }
  }
});

test("the values sit in their pre-printed boxes", () => {
  const label = buildIngredientLabel58100(TWO_D);
  const [weight, unitPrice, total] = label.elements.filter(
    (el) => el.kind === "text" && (el.y === 562 || el.y === 556),
  );

  assert.ok(weight.x >= STOCK.boxes.net.x0 && weight.x + weight.width <= STOCK.boxes.net.x1);
  assert.ok(
    unitPrice.x >= STOCK.boxes.unitPrice.x0 &&
      unitPrice.x + unitPrice.width <= STOCK.boxes.unitPrice.x1,
  );
  assert.ok(
    total.x >= STOCK.boxes.totalPrice.x0 && total.x + total.width <= STOCK.boxes.totalPrice.x1,
  );

  // And the date row sits under the rule, not on it.
  for (const el of label.elements.filter((e) => e.kind === "text" && e.y === 660)) {
    assert.ok(el.y > STOCK.rule, `${el.text} must clear the rule at ${STOCK.rule}`);
  }
});

test("dbg and copies ride through", () => {
  assert.equal(buildIngredientLabel58100(ONE_D).dbg, false);
  assert.equal(buildIngredientLabel58100(ONE_D, { dbg: true }).dbg, true);
  assert.ok(renderLabel(buildIngredientLabel58100(ONE_D, { copies: 2 })).includes("^PQ2"));
});

// ---------------------------------------------------------------------------
// The clip guard
// ---------------------------------------------------------------------------
//
// `^FB` does not truncate. Given more text than the block holds it prints the
// overflow *on top of* the last line it was given, and the label comes back
// with two strings on one row (hardware, 2026-08-28). Caller text is therefore
// cut to something that measurably fits, with `…` marking the cut.

const ABSURD_KO = "넓은상품명".repeat(20);
const ABSURD_EN = "WIDE PRODUCT NAME ".repeat(10);

function assertFits(el, what, cut = true) {
  assert.ok(el, `${what}: element built`);
  if (cut) assert.ok(el.text.endsWith("…"), `${what}: "${el.text}" was not cut`);
  assert.ok(
    textWidth(el.text, resolveTextSize(el)) <= el.width * (el.lines ?? 1),
    `${what}: "${el.text}" measures wider than its ${el.width} × ${el.lines ?? 1} block`,
  );
}

const head = (label, prefix) =>
  label.elements.find((el) => el.kind === "text" && el.text.startsWith(prefix));

test("caller text is cut to fit rather than printed over itself", () => {
  const label = buildIngredientLabel58100({
    ...ONE_D,
    nameEn: ABSURD_EN,
    ingredients: INGREDIENTS.repeat(6),
  });

  assertFits(head(label, "WIDE"), "name band");
  // The statement panel is five `^FB` rows and deliberately unshrunk: past five
  // rows the overflow used to land on the fifth. Now it is cut there.
  assertFits(head(label, "Salmon (Atlantic"), "ingredient statement");
});

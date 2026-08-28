// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { PRINTABLE_W, buildPriceTag7030, formatMoney } from "./price-tag-7030.ts";
import { ELLIPSIS, textWidth } from "../measure.ts";
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
  "long name, no promo": {
    ...SAMPLE,
    nameKo: LONG_KO,
    nameEn: LONG_EN,
    wasPriceCents: null,
    promoRange: null,
  },
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
/** Clipped text no longer equals what went in, so long names are found by their head. */
const byHead = (label, head) => texts(label).find((el) => el.text.startsWith(head));
const KO_HEAD = "[농심]";
const EN_HEAD = "[Nongshim]";
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

/**
 * The name block, after the owner's rule of 2026-08-28.
 *
 * One paragraph at one size: Korean Bold first, English Medium continuing on
 * whatever rows are left. Three rows on a plain tag, two when the was-price
 * needs the footer's left half, and the row that reaches into the footer band
 * is narrowed so it stops before the digits.
 */
const NAME_SIZE = 26;
const ROW_Y = [110, 140, 170];
/**
 * Rows one and two get the whole width; row three shares the footer band and
 * runs to where the right-aligned digits actually start (their glyph edge, not
 * their block edge), 8 dots short — for the usual 13-digit barcode at 20pt
 * that is 442 − 151 − 8 − 18 + 72 = 337 — the +72 overlap into the digit zone
 * is owner-approved (digits sit 8 dots lower, so it still reads).
 */
const ROW_W = [424, 424, 337];

/** Every name row on the label, top to bottom. */
const nameRowsOf = (label) =>
  texts(label)
    .filter((el) => el.size === NAME_SIZE)
    .sort((a, b) => a.y - b.y);

test("the two names are one block at one size, not a heading and a caption", () => {
  // The split this replaced set Korean at 30 over English at 27, which printed
  // as a title with an unreadable subtitle — "the English is meaningless".
  const label = buildPriceTag7030(SAMPLE);
  const ko = byText(label, SAMPLE.nameKo);
  const en = byText(label, SAMPLE.nameEn);

  assert.equal(ko.weight, "B", "weight is what tells the two apart…");
  assert.equal(en.weight, "M");
  assert.equal(resolveTextSize(ko), NAME_SIZE, "…and size is not");
  assert.equal(resolveTextSize(en), NAME_SIZE);
  assert.equal(ko.lines, 1, "one element per row, so no element wraps");
  assert.equal(en.lines, 1);

  assert.equal(ko.y, ROW_Y[0]);
  assert.equal(en.y, ROW_Y[1], "English continues directly under the Korean");
  assert.equal(en.y - ko.y, 30, "one leading, uniform down the block");
  assert.equal(ko.width, ROW_W[0]);
  assert.equal(en.width, ROW_W[1]);

  const price = elementBounds(dollarsOf(label));
  assert.ok(ko.y >= price.y + price.h, "the block clears the price cell");
});

test("Korean wraps first and English takes the rows that are left", () => {
  const label = buildPriceTag7030(INPUTS["long name, no promo"]);
  assert.ok(!renderLabel(label).includes("was $"), "this is the three-row shape");

  const rows = nameRowsOf(label);
  assert.equal(rows.length, 3, "three rows, all of them used");
  assert.deepEqual(
    rows.map((el) => el.y),
    ROW_Y,
  );
  assert.deepEqual(
    rows.map((el) => el.width),
    ROW_W,
    "the row inside the footer band is the narrow one",
  );
  assert.deepEqual(rows.map((el) => el.weight), ["B", "B", "M"], "two Korean rows, then English");
  for (const el of rows) assert.equal(resolveTextSize(el), NAME_SIZE, "one size throughout");

  // The Korean wrapped rather than shrank, and it is all there.
  assert.equal(rows[0].text + " " + rows[1].text, LONG_KO);
  // The English got one row, so it is cut to that row.
  assert.ok(rows[2].text.startsWith(EN_HEAD));
  assert.ok(rows[2].text.endsWith(ELLIPSIS), `"${rows[2].text}" was not cut`);

  const last = elementBounds(rows[2]);
  assert.ok(last.y + last.h <= SAFE_BOTTOM, `the block ends at ${last.y + last.h}`);
});

test("English can take more than one row when the Korean is short", () => {
  const label = buildPriceTag7030({ ...INPUTS.normal, nameKo: "혼다시", nameEn: LONG_EN });
  const rows = nameRowsOf(label);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((el) => el.weight), ["B", "M", "M"], "one Korean row, two English");
  assert.equal(rows[0].text, "혼다시");
  assert.ok(rows[1].text.startsWith(EN_HEAD), "the English starts on row two");
  assert.ok(LONG_EN.startsWith(rows[1].text), "and row two is a prefix of it");
});

test("a promo tag gets two rows, and a long Korean name takes both", () => {
  const label = buildPriceTag7030(INPUTS["long name"]);
  assert.ok(byText(label, "was $62.00  26/08 - 27/08"), "this is the promo shape");

  const rows = nameRowsOf(label);
  assert.equal(rows.length, 2, "the was-price owns the third row's space");
  assert.deepEqual(
    rows.map((el) => el.y),
    ROW_Y.slice(0, 2),
  );
  assert.deepEqual(rows.map((el) => el.width), [424, 424], "neither row reaches the footer band");
  assert.deepEqual(rows.map((el) => el.weight), ["B", "B"], "both rows are Korean…");
  assert.equal(rows[0].text + " " + rows[1].text, LONG_KO);
  // …so the English is dropped outright rather than printed as a fragment.
  assert.ok(!renderLabel(label).includes("Nongshim"), "no half a translation");
});

test("a short name on a promo tag still gets its English row", () => {
  const label = buildPriceTag7030(SAMPLE);
  const rows = nameRowsOf(label);
  assert.deepEqual(rows.map((el) => el.text), [SAMPLE.nameKo, SAMPLE.nameEn]);
  assert.deepEqual(rows.map((el) => el.weight), ["B", "M"]);
});

test("nothing in the name block shrinks — it is cut instead", () => {
  for (const input of Object.values(INPUTS)) {
    for (const el of nameRowsOf(buildPriceTag7030(input))) {
      assert.ok(!el.shrink, `"${el.text}" declared a shrink`);
      assert.equal(resolveTextSize(el), NAME_SIZE, `"${el.text}" is not at the block size`);
      assert.ok(
        textWidth(el.text, NAME_SIZE) <= el.width,
        `"${el.text}" measures wider than its ${el.width}-dot row`,
      );
    }
  }
});

test("a dropped English row stops before the barcode digits", () => {
  const label = buildPriceTag7030(INPUTS["long name, no promo"]);
  const digitsBox = elementBounds(byText(label, SAMPLE.barcode));

  for (const el of texts(label)) {
    if (el.text === SAMPLE.barcode) continue;
    const box = elementBounds(el);
    // anything that shares a row with the digits has to end before they start
    const overlapsRow = box.y < digitsBox.y + digitsBox.h && box.y + box.h > digitsBox.y;
    if (!overlapsRow) continue;
    // The digits are right-aligned inside their block; a name row may run up
    // to 72 dots past their glyphs' left edge (owner-approved overlap).
    const digitGlyphLeft = digitsBox.x + digitsBox.w - textWidth(SAMPLE.barcode, 20);
    assert.ok(
      box.x + box.w <= digitGlyphLeft + 72,
      `"${el.text}" reaches ${box.x + box.w} ≥ ${digitGlyphLeft + 72}`,
    );
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

// ---------------------------------------------------------------------------
// The clip guard
// ---------------------------------------------------------------------------

/** Nothing a catalogue can hold, which is the point — the block has to win. */
const ABSURD_KO = "넓은상품명".repeat(20);
const ABSURD_EN = "WIDE PRODUCT NAME ".repeat(10);

/** Every block on this tag has to end up wider than the text inside it. */
function assertFits(el, what) {
  assert.ok(el, `${what}: element built`);
  assert.ok(el.text.endsWith(ELLIPSIS), `${what}: "${el.text}" was not cut`);
  assert.ok(
    textWidth(el.text, resolveTextSize(el)) <= el.width * (el.lines ?? 1),
    `${what}: "${el.text}" measures wider than its ${el.width} × ${el.lines ?? 1} block`,
  );
}

test("caller text is cut to fit rather than printed over itself", () => {
  // `^FB` does not truncate: the overflow lands on top of the last line it was
  // given. Hardware, 2026-08-28 — a tag came back reading `Botttlashait.RonDreShoup`.
  const promo = buildPriceTag7030({
    ...SAMPLE,
    nameKo: ABSURD_KO,
    nameEn: ABSURD_EN,
    promoRange: "the whole of the month of September and then some",
    barcode: "9300001028165900001028165",
  });
  assertFits(byHead(promo, "was $62.00"), "was-price and range");
  assertFits(byHead(promo, "93000010"), "barcode digits");

  // In the name block the wrap fills the rows and only the **last** one is cut,
  // because that is where the text the tag has no room for ends up.
  for (const input of [promo, buildPriceTag7030({ ...INPUTS.normal, nameKo: ABSURD_KO })]) {
    const rows = nameRowsOf(input);
    assert.equal(rows.length, input === promo ? 2 : 3, "every row is used");
    for (const el of rows) {
      assert.ok(
        textWidth(el.text, NAME_SIZE) <= el.width,
        `"${el.text}" measures wider than its ${el.width}-dot row`,
      );
    }
    assert.ok(rows.at(-1).text.endsWith(ELLIPSIS), `"${rows.at(-1).text}" was not cut`);
    for (const el of rows) {
      assert.ok(textWidth(el.text, NAME_SIZE) <= el.width, `"${el.text}" overflows`);
    }
  }

  // A Korean name this long eats every row, so there is no English at all.
  const normal = buildPriceTag7030({ ...INPUTS.normal, nameKo: ABSURD_KO, nameEn: ABSURD_EN });
  assert.ok(!renderLabel(normal).includes("WIDE"), "the English is dropped, not squeezed");
  assert.deepEqual(nameRowsOf(normal).map((el) => el.weight), ["B", "B", "B"]);

  // …and the row that shares the footer band stays within its allowance: the
  // digits' glyph edge plus the owner-approved 72-dot overlap.
  const last = elementBounds(nameRowsOf(normal).at(-1));
  const digits = elementBounds(byText(normal, SAMPLE.barcode));
  assert.ok(last.x + last.w <= digits.x + digits.w - textWidth(SAMPLE.barcode, 20) + 72);
});

test("everything the guard touches still fits inside the tag", () => {
  const label = buildPriceTag7030({
    ...INPUTS.normal,
    nameKo: ABSURD_KO,
    nameEn: ABSURD_EN,
  });
  for (const el of label.elements) {
    const box = elementBounds(el);
    assert.ok(box.x + box.w <= PRINTABLE_W, `${el.kind} right edge ${box.x + box.w}`);
    assert.ok(box.y + box.h <= SAFE_BOTTOM, `${el.kind} bottom ${box.y + box.h}`);
  }
});

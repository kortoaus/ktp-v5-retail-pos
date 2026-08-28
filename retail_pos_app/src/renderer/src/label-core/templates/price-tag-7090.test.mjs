// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceTag7090, getPriceTag7090Model } from "./price-tag-7090.ts";
import { ELLIPSIS, textWidth } from "../measure.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel, resolveTextSize } from "../zpl.ts";

const BASE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  uom: "kg",
  priceCents: 6200,
  barcode: "9300001028165",
  storeName: "DREAM MARKET",
};

const CASES = {
  "normal-guest": { ...BASE },
  "normal-member": { ...BASE, memberPriceCents: 5900 },
  "promo-guest": {
    ...BASE,
    priceCents: 5500,
    wasPriceCents: 6200,
    promoName: "Special",
    promoRange: "26/08 - 27/08",
  },
  "promo-member": {
    ...BASE,
    priceCents: 5500,
    wasPriceCents: 6200,
    memberPriceCents: 5200,
    promoName: "Special",
    promoRange: "26/08 - 27/08",
  },
};

test("the four cases come out of the four input shapes", () => {
  for (const [expected, input] of Object.entries(CASES)) {
    assert.equal(getPriceTag7090Model(input).caseName, expected);
  }
});

test("a member price that does not beat the guest price is not a member price", () => {
  assert.equal(
    getPriceTag7090Model({ ...BASE, memberPriceCents: 6200 }).caseName,
    "normal-guest",
  );
  assert.equal(getPriceTag7090Model({ ...BASE, memberPriceCents: 0 }).caseName, "normal-guest");
});

test("mode 'normal' prints the shelf price and forgets the promotion", () => {
  const model = getPriceTag7090Model({ ...CASES["promo-member"], mode: "normal" });
  assert.equal(model.caseName, "normal-member");
  assert.equal(model.guestCents, 6200);
  assert.equal(model.isPromo, false);
});

test("the headline says who the tag is for", () => {
  assert.equal(getPriceTag7090Model(CASES["normal-guest"]).headline, "DREAM MARKET");
  assert.equal(getPriceTag7090Model(CASES["normal-member"]).headline, "Member Price");
  assert.equal(getPriceTag7090Model(CASES["promo-guest"]).headline, "Special");
  assert.equal(
    getPriceTag7090Model({ ...CASES["promo-guest"], promoName: null }).headline,
    "Special",
  );
});

test("only the member cases carry a GUEST line and a divider", () => {
  const has = (input, needle) => renderLabel(buildPriceTag7090(input)).includes(needle);

  assert.ok(!has(CASES["normal-guest"], "GUEST "));
  assert.ok(has(CASES["normal-member"], "^FDGUEST $62.00 /kg^FS"));
  assert.ok(has(CASES["promo-member"], "^FDGUEST $55.00 /kg^FS"));
  assert.ok(has(CASES["normal-member"], "^FO24,504^GB512,1,1^FS"), "hairline divider");
  assert.ok(has(CASES["promo-guest"], "^FO24,472^GB512,1,1^FS"));
  assert.ok(!has(CASES["normal-guest"], "^GB512,1,1"), "no divider without a second block");
});

test("promo cases print the was-price, the saving and the dates", () => {
  const promo = renderLabel(buildPriceTag7090(CASES["promo-guest"]));
  assert.ok(promo.includes("^FDWas $62.00^FS"));
  assert.ok(promo.includes("^FDSAVE $7.00^FS"));
  assert.ok(promo.includes("^FD26/08 - 27/08^FS"));

  // The member saving is measured from the shelf price, not from the promo.
  const member = renderLabel(buildPriceTag7090(CASES["promo-member"]));
  assert.ok(member.includes("^FDSAVE $10.00^FS"), member);

  const normal = renderLabel(buildPriceTag7090(CASES["normal-guest"]));
  assert.ok(!normal.includes("Was $"));
});

test("a saving under a dollar prints in cents", () => {
  const zpl = renderLabel(
    buildPriceTag7090({ ...CASES["normal-member"], memberPriceCents: 6149 }),
  );
  assert.ok(zpl.includes("^FDSAVE 51c^FS"), zpl);
});

test("the headline is Black 52 on promo, 62 otherwise, and shrinks no further than the floor", () => {
  const headlineOf = (input) =>
    buildPriceTag7090(input).elements.find(
      (el) => el.kind === "text" && el.align === "C" && el.width === 500 && el.weight === "BK",
    );

  const normal = headlineOf(CASES["normal-guest"]);
  assert.equal(normal.size, 62);
  assert.equal(normal.minSize, 42);

  const promo = headlineOf(CASES["promo-guest"]);
  assert.equal(promo.size, 52);
  assert.equal(promo.minSize, 36);

  const long = headlineOf({
    ...CASES["promo-guest"],
    promoName: "Manager's Weekend Special Extravaganza",
  });
  assert.ok(resolveTextSize(long) < 52, "a long headline shrinks");
  assert.equal(resolveTextSize(long), long.minSize, "down to the floor, not past it");
  // …and at the floor it is *cut*, because `^FB` prints what does not fit on
  // top of what does. Hardware, 2026-08-28.
  assert.ok(long.text.endsWith(ELLIPSIS), `"${long.text}" was not clipped`);
  assert.ok(textWidth(long.text, resolveTextSize(long)) <= long.width);
});

test("the price is Black, split, and centred as one unit", () => {
  const label = buildPriceTag7090(CASES["normal-guest"]);
  const dollars = label.elements.find((el) => el.kind === "text" && el.text === "$62");
  const cents = label.elements.find((el) => el.kind === "text" && el.text === "00");

  assert.equal(dollars.weight, "BK");
  assert.equal(cents.weight, "BK");
  assert.equal(dollars.size, 156);
  assert.equal(cents.size, 86);
  assert.ok(cents.x > dollars.x, "cents follow the dollars");
  // Lifted: the cents' own baseline sits above the dollars' baseline, even
  // though a smaller cell means its top starts lower down the label.
  const baseline = (el) => el.y + Math.round(el.size * 0.8);
  assert.ok(baseline(cents) < baseline(dollars), "and are lifted above the baseline");
});

test("a four-figure price shrinks until it fits the tag", () => {
  const label = buildPriceTag7090({ ...CASES["normal-guest"], priceCents: 129999 });
  const dollars = label.elements.find((el) => el.kind === "text" && el.text === "$1299");
  assert.ok(dollars.size < 156, `shrunk to ${dollars.size}`);
});

test("the barcode reads top-left, bottom-left and inside the Data Matrix", () => {
  const zpl = renderLabel(buildPriceTag7090(CASES["promo-member"]));
  assert.ok(zpl.includes("^FO475,608^BXN,5,200^FH^FD9300001028165^FS"), zpl);
  assert.equal(zpl.split("9300001028165").length - 1, 3);
});

test("both human-readable digit lines print, in all four cases", () => {
  for (const [name, input] of Object.entries(CASES)) {
    const zpl = renderLabel(buildPriceTag7090(input));
    assert.ok(zpl.includes("^FO24,30^"), `${name}: top-left digit line at y30`);
    assert.ok(zpl.includes("^FO24,638^"), `${name}: bottom digit line at y638`);
    // Both carry the barcode itself, not a truncation of it.
    assert.equal(
      zpl.split("^FH^FD9300001028165^FS").length - 1,
      3,
      `${name}: two digit lines + the Data Matrix`,
    );
  }
});

// ---------------------------------------------------------------------------
// The member stack
// ---------------------------------------------------------------------------

const MEMBER_CASES = ["normal-member", "promo-member"];

/** The three rows the shopper reads as one column, plus the raised cents. */
function memberStack(input) {
  const els = buildPriceTag7090(input).elements;
  const text = (pred) => els.find((el) => el.kind === "text" && pred(el));
  // splitPrice emits the only unblocked Black fields on the tag; everything
  // else that is Black declares a ^FB width.
  const big = els.filter((el) => el.kind === "text" && el.weight === "BK" && !el.width);

  return {
    guest: text((el) => el.text.startsWith("GUEST ")),
    member: text((el) => el.text === "MEMBER"),
    dollars: big.find((el) => /^\$\d+$/.test(el.text)),
    cents: big.find((el) => /^\d{2}$/.test(el.text)),
  };
}

test("GUEST, MEMBER and the big price are three separated rows, not a pile", () => {
  for (const name of MEMBER_CASES) {
    const { guest, member, dollars, cents } = memberStack(CASES[name]);
    assert.ok(guest && member && dollars && cents, `${name}: all four rows present`);

    const box = (el) => elementBounds(el);
    const gap = (prev, next) => box(next).y - (box(prev).y + box(prev).h);

    // 12 dots is the floor the hardware run of 2026-08-26 asked for; the layout
    // aims higher (16 above MEMBER, 20 below it) so a font tweak has slack.
    assert.ok(
      gap(guest, member) >= 12,
      `${name}: GUEST→MEMBER gap ${gap(guest, member)} < 12`,
    );
    assert.ok(
      gap(member, dollars) >= 12,
      `${name}: MEMBER→$ gap ${gap(member, dollars)} < 12`,
    );
    assert.ok(
      gap(member, cents) >= 12,
      `${name}: MEMBER→cents gap ${gap(member, cents)} < 12`,
    );

    // And the order on the label is the order in the list.
    assert.ok(box(guest).y < box(member).y, `${name}: GUEST above MEMBER`);
    assert.ok(box(member).y < box(dollars).y, `${name}: MEMBER above the price`);
  }
});

test("both member cases share one price geometry", () => {
  const [a, b] = MEMBER_CASES.map((name) => memberStack(CASES[name]));
  for (const key of ["guest", "member", "dollars", "cents"]) {
    assert.equal(a[key].y, b[key].y, `${key} y`);
    assert.equal(a[key].size, b[key].size, `${key} size`);
  }
  assert.equal(a.dollars.size, 120, "the member price is 120, down from 136/132");
  assert.equal(a.cents.size, 68);
});

test("the member stack stays clear of the divider, the Data Matrix and the digits", () => {
  for (const name of MEMBER_CASES) {
    const label = buildPriceTag7090(CASES[name]);
    const bottom = (el) => elementBounds(el).y + elementBounds(el).h;
    const stack = memberStack(CASES[name]);

    const divider = label.elements.find((el) => el.kind === "line" && el.thick === 1);
    assert.equal(divider.y, 504, `${name}: divider unmoved`);
    assert.ok(bottom(stack.dollars) < divider.y, `${name}: price above the divider`);

    const matrix = label.elements.find((el) => el.kind === "datamatrix");
    assert.equal(matrix.y, 608, `${name}: Data Matrix unmoved`);
    assert.ok(bottom(stack.dollars) < matrix.y);
  }
});

test("the non-member cases are untouched by the member rhythm", () => {
  // Byte-for-byte: the member fix must not have moved a guest tag.
  const normal = renderLabel(buildPriceTag7090(CASES["normal-guest"]));
  assert.ok(normal.includes("^FO92,210^A@N,156,"), normal);
  assert.ok(normal.includes("^FO200,360^A@N,28,"), "the /kg line");

  const promo = renderLabel(buildPriceTag7090(CASES["promo-guest"]));
  assert.ok(promo.includes("^FO102,217^A@N,146,"), promo);
  assert.ok(promo.includes("^FO24,398^A@N,28,"), "Was $ at 28");
  assert.ok(promo.includes("^FO330,396^A@N,30,"), "SAVE at 30");
  assert.ok(promo.includes("^FO24,436^A@N,23,"), "the date range at 23");
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Two full Korean rows at 40 in a 430-dot block. */
const LONG_KO = "혼다시보틀 (테스트) 가다랑어 국물용 조미료";
const LONG_EN = "Hondashi Bonito Soup Stock Bottle Katsuo Dashi";

/** Top of the bottom digit line — the floor the name block may not reach. */
const DIGIT_LINE_Y = 638;

/** A clipped name no longer equals what went in, so names are found by their head. */
const nameOf = (label, text) =>
  label.elements.find((el) => el.kind === "text" && el.text.startsWith(text.slice(0, 8)));

test("two Korean rows plus one English row still clear the digit line", () => {
  // The busiest case (member stack *and* promo footer) and the plainest one:
  // if the tall tag fits, the short one has room to spare.
  for (const name of ["promo-member", "normal-guest"]) {
    const label = buildPriceTag7090({ ...CASES[name], nameKo: LONG_KO, nameEn: LONG_EN });
    const ko = nameOf(label, LONG_KO);
    const en = nameOf(label, LONG_EN);

    assert.equal(ko.text, LONG_KO, `${name}: two rows hold the whole name, uncut`);
    assert.equal(ko.lines, 2, `${name}: the Korean name takes both rows`);
    assert.equal(ko.size, 40, `${name}: at full size — the Korean name does not shrink`);
    assert.equal(en.lines, 1, `${name}: English never takes a second row`);

    const koBox = elementBounds(ko);
    const enBox = elementBounds(en);
    assert.ok(enBox.y >= koBox.y + koBox.h, `${name}: English under the Korean block`);
    assert.ok(
      enBox.y + enBox.h <= DIGIT_LINE_Y,
      `${name}: English bottom ${enBox.y + enBox.h} > ${DIGIT_LINE_Y}`,
    );

    const digits = label.elements.find(
      (el) => el.kind === "text" && el.text === BASE.barcode && el.y === DIGIT_LINE_Y,
    );
    assert.ok(digits, `${name}: the digit line is where it always was`);
  }
});

test("a long English name shrinks toward 20 instead of wrapping", () => {
  const label = buildPriceTag7090({ ...CASES["promo-member"], nameEn: LONG_EN });
  const en = nameOf(label, LONG_EN);
  assert.equal(en.lines, 1);
  assert.ok(resolveTextSize(en) < 27, `still at ${resolveTextSize(en)}`);
  assert.equal(resolveTextSize(en), 20, "and stops at the 20-dot floor");
  // Still too wide at the floor, so it is cut rather than printed over itself.
  assert.ok(en.text.endsWith(ELLIPSIS), `"${en.text}" was not clipped`);
  assert.ok(textWidth(en.text, resolveTextSize(en)) <= en.width);
});

test("nothing lands outside 560 × 720, in any of the four cases", () => {
  const [pageW, pageH] = MEDIA["7090"].dots;
  const inputs = [
    ...Object.values(CASES),
    { ...CASES["promo-member"], priceCents: 129999, wasPriceCents: 149999, uom: "100g" },
    { ...CASES["normal-member"], priceCents: 129999, memberPriceCents: 119999, uom: "100g" },
    {
      ...CASES["normal-guest"],
      nameKo: "아주 긴 한글 상품명 테스트 모듬사시미 특선 플래터",
      nameEn: "A Very Long English Product Name That Has To Wrap Twice",
    },
    {
      ...CASES["normal-member"],
      nameKo: "아주 긴 한글 상품명 테스트 모듬사시미 특선 플래터",
    },
    { ...CASES["promo-member"], nameKo: LONG_KO, nameEn: LONG_EN },
    { ...CASES["normal-guest"], nameKo: LONG_KO, nameEn: LONG_EN },
  ];
  for (const input of inputs) {
    for (const el of buildPriceTag7090(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("dbg rides through", () => {
  assert.equal(buildPriceTag7090(CASES["normal-guest"], { dbg: true }).dbg, true);
});

// ---------------------------------------------------------------------------
// The clip guard
// ---------------------------------------------------------------------------

const ABSURD_KO = "넓은상품명".repeat(20);
const ABSURD_EN = "WIDE PRODUCT NAME ".repeat(10);

function assertFits(el, what, cut = true) {
  assert.ok(el, `${what}: element built`);
  if (cut) assert.ok(el.text.endsWith(ELLIPSIS), `${what}: "${el.text}" was not cut`);
  assert.ok(
    textWidth(el.text, resolveTextSize(el)) <= el.width * (el.lines ?? 1),
    `${what}: "${el.text}" measures wider than its ${el.width} × ${el.lines ?? 1} block`,
  );
}

const head = (label, prefix) =>
  label.elements.find((el) => el.kind === "text" && el.text.startsWith(prefix));

test("caller text is cut to fit rather than printed over itself", () => {
  // `^FB` prints what does not fit on top of what does — the 2026-08-28 photos
  // show a promo headline and an English name both folded onto themselves.
  const label = buildPriceTag7090({
    ...CASES["promo-member"],
    promoName: "Manager's Weekend Special Extravaganza Sale Event 123456789",
    nameKo: ABSURD_KO,
    nameEn: ABSURD_EN,
    promoRange: "the whole of the month of September and the first week of October",
    uom: "100g of drained weight",
    barcode: "9300001028165930000102816593000010281659300001028165",
  });

  assertFits(head(label, "Manager's"), "promo headline");
  assertFits(head(label, "넓은"), "Korean name");
  assertFits(head(label, "WIDE"), "English name");
  assertFits(head(label, "the whole"), "promotion dates");
  assertFits(head(label, "/100g"), "the unit line");
  // Shrinking was enough for this one — the cut is the last resort, not the
  // first, and a 500-dot block with a 24-dot floor has room to absorb a wordy
  // unit. What matters is the same invariant either way.
  assertFits(head(label, "GUEST "), "the GUEST line", false);
  assertFits(head(label, "93000010"), "the barcode digit line");
});

test("a cut name still clears the digit line", () => {
  for (const name of ["promo-member", "normal-guest"]) {
    const label = buildPriceTag7090({ ...CASES[name], nameKo: ABSURD_KO, nameEn: ABSURD_EN });
    const en = elementBounds(head(label, "WIDE"));
    assert.ok(
      en.y + en.h <= DIGIT_LINE_Y,
      `${name}: English bottom ${en.y + en.h} > ${DIGIT_LINE_Y}`,
    );
  }
});

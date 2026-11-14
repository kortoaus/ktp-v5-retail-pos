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
//
// Since v1.8.9 (platform F-37) the template breaks the names itself: one
// single-line element per row, each row as wide as the tag allows at its own
// height. These tests pin the rows the printer is given.

/** Two Korean rows at 40: `혼다시보틀 (테스트)` / `가다랑어 국물용 조미료`. */
const LONG_KO = "혼다시보틀 (테스트) 가다랑어 국물용 조미료";
const LONG_EN = "Hondashi Bonito Soup Stock Bottle Katsuo Dashi";
/** Two English rows' worth at 27, more than one row holds at 20. */
const LONGER_EN = "Hondashi Bonito Soup Stock Bottle Katsuo Dashi Large Catering Pack";

const ABSURD_KO = "넓은상품명".repeat(20);
const ABSURD_EN = "WIDE PRODUCT NAME ".repeat(10);

/** Top of the bottom digit line — the floor the name rows may not reach. */
const DIGIT_LINE_Y = 638;
const MATRIX_Y = 608;
/** The air the template keeps between two name cells (42 pitch − 40 size). */
const ROW_GAP = 2;
const FULL_W = 512;
const BESIDE_MATRIX_W = 430;

/** The owner's tag, 2026-11-15 (photo; finding platform F-37). */
const OWNER = {
  nameKo: "[쭈꾸뿅] 쭈꾸뿅 양념쭈꾸미 순한맛 300g",
  nameEn: "[Jjukkubbong] Jjukkubbong Seasoned Webfoot Octopus Mild 300g",
  uom: "EA",
  priceCents: 1790,
  barcode: "08809521730180",
  storeName: "Dream Market",
};

const NAME_SETS = {
  short: { nameKo: BASE.nameKo, nameEn: BASE.nameEn },
  "two-row": { nameKo: LONG_KO, nameEn: LONGER_EN },
  "over-long": { nameKo: ABSURD_KO, nameEn: ABSURD_EN },
  "over-long, spaced": {
    nameKo: "아주 긴 한글 상품명 테스트 모듬사시미 특선 플래터 대용량 업소용 냉동",
    nameEn: "A Very Long English Product Name That Has To Wrap Twice And Then Some More",
  },
  "korean only": { nameKo: LONG_KO, nameEn: "" },
  "english only": { nameKo: "", nameEn: LONGER_EN },
  owner: { nameKo: OWNER.nameKo, nameEn: OWNER.nameEn },
};

/**
 * The tag split into its name rows and everything else. The name rows are
 * what appears only when there is a name, between the fixed elements above
 * and the Data Matrix + bottom digits below.
 */
function split(input) {
  const label = buildPriceTag7090(input);
  const bare = buildPriceTag7090({ ...input, nameKo: "", nameEn: "" }).elements.length;
  const els = label.elements;
  const names = els.slice(bare - 2, els.length - 2);
  const fixed = [...els.slice(0, bare - 2), ...els.slice(els.length - 2)];
  const ko = names.filter((el) => el.size === 40);
  const en = names.filter((el) => el.size !== 40);
  return { label, names, fixed, ko, en };
}

const rowsOf = (els) => els.map((el) => [el.x, el.y, el.size, el.width, el.text]);
const bottom = (el) => elementBounds(el).y + elementBounds(el).h;
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the owner's tag prints both names in full, on two rows each", () => {
  // v1.8.8 gave, for the same input: `[쭈꾸뿅] 쭈꾸뿅 양념쭈꾸미 순한맛 30…`
  // (one 430 × 2 `^FB` block, cut on the estimator's wrap — the printer then
  // left line 2 half empty) and `[Jjukkubbong] Jjukkubbong Seasoned We…` (one
  // row, shrunk to 20, cut).
  assert.equal(getPriceTag7090Model(OWNER).caseName, "normal-guest");
  const { ko, en } = split(OWNER);

  assert.deepEqual(rowsOf(ko), [
    [24, 408, 40, 512, "[쭈꾸뿅] 쭈꾸뿅 양념쭈꾸미"],
    [24, 450, 40, 512, "순한맛 300g"],
  ]);
  assert.deepEqual(rowsOf(en), [
    [24, 502, 27, 512, "[Jjukkubbong] Jjukkubbong"],
    [24, 531, 27, 512, "Seasoned Webfoot Octopus Mild 300g"],
  ]);
  assert.equal(ko.map((el) => el.text).join(" "), OWNER.nameKo);
  assert.equal(en.map((el) => el.text).join(" "), OWNER.nameEn);
  for (const el of [...ko, ...en]) assert.ok(!el.text.includes(ELLIPSIS), el.text);
});

test("every name row is one single-line element that measures inside its row", () => {
  for (const [name, base] of Object.entries(CASES)) {
    for (const [set, names] of Object.entries(NAME_SETS)) {
      const { ko, en } = split({ ...base, ...names });
      assert.ok(ko.length <= 2, `${name}/${set}: Korean on ${ko.length} rows`);
      assert.ok(en.length <= 2, `${name}/${set}: English on ${en.length} rows`);
      for (const el of [...ko, ...en]) {
        const what = `${name}/${set}: "${el.text}"`;
        assert.equal(el.lines, 1, `${what} is a multi-line block`);
        assert.ok(!el.shrink, `${what} leaves its size to the printer`);
        assert.equal(resolveTextSize(el), el.size);
        assert.ok(
          textWidth(el.text, el.size) <= el.width,
          `${what} measures ${textWidth(el.text, el.size)} > ${el.width}`,
        );
      }
      for (const el of ko) assert.equal(el.size, 40, `${name}/${set}: Korean at 40`);
      for (const el of en) {
        assert.ok(el.size <= 27 && el.size >= 20, `${name}/${set}: English at ${el.size}`);
        assert.equal(el.size, en[0].size, `${name}/${set}: one size per name`);
      }
    }
  }
});

test("each row is as wide as its height allows, and no name cell touches anything", () => {
  for (const [name, base] of Object.entries(CASES)) {
    for (const [set, names] of Object.entries(NAME_SETS)) {
      const { names: rows, fixed } = split({ ...base, ...names });
      rows.forEach((el, i) => {
        const what = `${name}/${set} row ${i + 1} "${el.text}"`;
        const box = elementBounds(el);
        assert.equal(el.x, 24, what);
        // Full width only when the cell ends, with the row gap, above the
        // Data Matrix; otherwise the 430 that stops at x454, short of x475.
        const expected = box.y + box.h + ROW_GAP <= MATRIX_Y ? FULL_W : BESIDE_MATRIX_W;
        assert.equal(el.width, expected, `${what}: width`);
        assert.ok(bottom(el) <= DIGIT_LINE_Y, `${what}: bottom ${bottom(el)} > ${DIGIT_LINE_Y}`);
        for (const other of fixed) {
          assert.ok(
            !overlaps(box, elementBounds(other)),
            `${what} overlaps ${other.kind} ${JSON.stringify(elementBounds(other))}`,
          );
        }
        if (i > 0) {
          const prev = elementBounds(rows[i - 1]);
          assert.ok(box.y >= prev.y + prev.h + ROW_GAP, `${what}: ${ROW_GAP} dots under the row above`);
        }
      });
    }
  }
});

test("English takes a second row only where that row still ends above the digit line", () => {
  // normal-guest has the room after two Korean rows; every layout has it after one.
  const roomy = [
    ["normal-guest", LONG_KO],
    ["normal-guest", BASE.nameKo],
    ["normal-member", BASE.nameKo],
    ["promo-guest", BASE.nameKo],
    ["promo-member", BASE.nameKo],
  ];
  for (const [name, nameKo] of roomy) {
    const { en } = split({ ...CASES[name], nameKo, nameEn: LONGER_EN });
    assert.equal(en.length, 2, `${name}: English on two rows`);
    assert.equal(en.map((el) => el.text).join(" "), LONGER_EN, `${name}: in full`);
  }
  // Two Korean rows on the three tall layouts: one English row, as before.
  for (const name of ["normal-member", "promo-guest", "promo-member"]) {
    const { ko, en } = split({ ...CASES[name], nameKo: LONG_KO, nameEn: LONGER_EN });
    assert.equal(ko.length, 2, `${name}: two Korean rows`);
    assert.equal(en.length, 1, `${name}: English stays one row`);
    assert.equal(en[0].size, 20, `${name}: shrunk to the 20-dot floor`);
    assert.ok(en[0].text.endsWith(ELLIPSIS), `${name}: and cut, "${en[0].text}"`);
  }
});

test("promo-member with two Korean rows: the rows beside the Data Matrix stay 430", () => {
  const { ko, en, fixed } = split({ ...CASES["promo-member"], nameKo: LONG_KO, nameEn: LONGER_EN });
  assert.deepEqual(rowsOf(ko), [
    [24, 516, 40, 512, "혼다시보틀 (테스트)"],
    [24, 558, 40, 512, "가다랑어 국물용 조미료"],
  ]);
  // Same place and size as v1.8.8's English field (top y610, shrunk to 20).
  assert.deepEqual(rowsOf(en), [[24, 610, 20, 430, "Hondashi Bonito Soup Stock Bottle Kats…"]]);

  const matrix = elementBounds(fixed.find((el) => el.kind === "datamatrix"));
  const digits = elementBounds(fixed.find((el) => el.kind === "text" && el.y === DIGIT_LINE_Y));
  assert.deepEqual(matrix, { x: 475, y: 608, w: 80, h: 80 });
  assert.deepEqual(digits, { x: 24, y: 638, w: 390, h: 20 });
  assert.equal(bottom(ko[1]), 598, "the lowest Korean cell ends 10 dots above the matrix");
  assert.equal(24 + en[0].width, 454, "the English row stops 21 dots short of it");
  assert.equal(bottom(en[0]), 630, "and 8 dots above the digit line");
});

test("a name is cut only on its last row, and only when its rows are full", () => {
  for (const [name, base] of Object.entries(CASES)) {
    for (const [set, names] of Object.entries(NAME_SETS)) {
      const { ko, en } = split({ ...base, ...names });
      for (const [rows, text] of [
        [ko, names.nameKo],
        [en, names.nameEn],
      ]) {
        rows.slice(0, -1).forEach((el) => {
          assert.ok(!el.text.includes(ELLIPSIS), `${name}/${set}: cut before the last row`);
        });
        const last = rows.at(-1);
        if (last && !last.text.endsWith(ELLIPSIS) && text.includes(" ")) {
          assert.equal(rows.map((el) => el.text).join(" "), text, `${name}/${set}: in full`);
        }
      }
    }
  }
  // The over-long names are cut, on their last row.
  for (const name of Object.keys(CASES)) {
    const { ko, en } = split({ ...CASES[name], ...NAME_SETS["over-long"] });
    assert.equal(ko.length, 2, name);
    assert.ok(ko[1].text.endsWith(ELLIPSIS), `${name}: "${ko[1].text}"`);
    assert.ok(en.at(-1).text.endsWith(ELLIPSIS), `${name}: "${en.at(-1).text}"`);
  }
});

test("a word wider than a row is broken between characters, not cut", () => {
  const word = "초특대왕크기모듬사시미세트구성"; // 15 × 40 = 600 dots, a row is 512
  const { ko } = split({ ...CASES["normal-member"], nameKo: `특선 ${word}`, nameEn: "" });
  assert.equal(ko.length, 2);
  // `특선 ` + 10 of the 15 characters = 12.3 em = 492 dots; the 11th would be 532.
  assert.equal(ko[0].text, "특선 초특대왕크기모듬사시");
  assert.equal(ko[0].text + ko[1].text, `특선 ${word}`);
  assert.ok(!ko[1].text.includes(ELLIPSIS));

  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMN"; // 40 capitals, 680 dots at 27
  const { en } = split({ ...CASES["normal-guest"], nameEn: code });
  assert.equal(en.length, 2);
  assert.equal(en[0].size, 27, "no shrink needed once the word may break");
  assert.equal(en.map((el) => el.text).join(""), code);
  assert.ok(!en[1].text.includes(ELLIPSIS));
});

test("a name that fits one 430-dot row prints where v1.8.8 put it", () => {
  // Element values of v1.8.8 (top y; x 24; Korean 40, English 27):
  // [Korean, English after one Korean row, English alone].
  const V188 = {
    "normal-guest": [408, 460, 418],
    "normal-member": [516, 568, 526],
    "promo-guest": [494, 546, 504],
    "promo-member": [516, 568, 526],
  };
  const pairs = [
    [BASE.nameKo, BASE.nameEn],
    // 424 of 430 dots: the widest Korean name that was one row.
    ["가다랑어 국물용 조미료", "Bonito Soup Stock Bottle"],
  ];
  for (const [name, [koY, enY, enAloneY]] of Object.entries(V188)) {
    for (const [nameKo, nameEn] of pairs) {
      const both = split({ ...CASES[name], nameKo, nameEn });
      assert.deepEqual(
        both.names.map((el) => [el.x, el.y, el.size, el.text]),
        [
          [24, koY, 40, nameKo],
          [24, enY, 27, nameEn],
        ],
        name,
      );
      const alone = split({ ...CASES[name], nameKo: "", nameEn });
      assert.deepEqual(alone.names.map((el) => [el.x, el.y, el.size]), [[24, enAloneY, 27]], name);
    }
  }
});

test("every element but the names is where v1.8.8 put it", () => {
  // Fixed elements of v1.8.8 for the four CASES: [kind, x, y, size|w, text].
  const V188 = {
    "normal-guest": [
      ["text", 24, 30, 22, "9300001028165"], ["text", 30, 78, 62, "DREAM MARKET"],
      ["line", 24, 176, 512], ["text", 92, 210, 156, "$62"], ["text", 369, 241, 86, "00"],
      ["text", 200, 360, 28, "/kg"], ["datamatrix", 475, 608, 5], ["text", 24, 638, 20, "9300001028165"],
    ],
    "normal-member": [
      ["text", 24, 30, 22, "9300001028165"], ["text", 30, 78, 62, "Member Price"],
      ["line", 24, 176, 512], ["text", 30, 188, 34, "GUEST $62.00 /kg"], ["text", 130, 238, 32, "MEMBER"],
      ["text", 133, 290, 120, "$59"], ["text", 349, 313, 68, "00"], ["text", 200, 414, 26, "/kg"],
      ["text", 330, 450, 30, "SAVE $3.00"], ["line", 24, 504, 512],
      ["datamatrix", 475, 608, 5], ["text", 24, 638, 20, "9300001028165"],
    ],
    "promo-guest": [
      ["text", 24, 30, 22, "9300001028165"], ["text", 30, 68, 52, "Special"],
      ["line", 24, 176, 512], ["text", 102, 217, 146, "$55"], ["text", 362, 245, 82, "00"],
      ["text", 200, 359, 26, "/kg"], ["text", 24, 398, 28, "Was $62.00"], ["text", 330, 396, 30, "SAVE $7.00"],
      ["text", 24, 436, 23, "26/08 - 27/08"], ["line", 24, 472, 512],
      ["datamatrix", 475, 608, 5], ["text", 24, 638, 20, "9300001028165"],
    ],
    "promo-member": [
      ["text", 24, 30, 22, "9300001028165"], ["text", 30, 68, 52, "Special"],
      ["line", 24, 176, 512], ["text", 30, 188, 34, "GUEST $55.00 /kg"], ["text", 130, 238, 32, "MEMBER"],
      ["text", 133, 290, 120, "$52"], ["text", 349, 313, 68, "00"], ["text", 200, 406, 22, "/kg"],
      ["text", 24, 437, 26, "Was $62.00"], ["text", 330, 436, 28, "SAVE $10.00"],
      ["text", 24, 473, 21, "26/08 - 27/08"], ["line", 24, 504, 512],
      ["datamatrix", 475, 608, 5], ["text", 24, 638, 20, "9300001028165"],
    ],
  };
  const shape = (el) =>
    el.kind === "text"
      ? ["text", el.x, el.y, resolveTextSize(el), el.text]
      : el.kind === "line"
        ? ["line", el.x, el.y, el.w]
        : [el.kind, el.x, el.y, el.size];
  for (const [name, expected] of Object.entries(V188)) {
    for (const names of Object.values(NAME_SETS)) {
      assert.deepEqual(split({ ...CASES[name], ...names }).fixed.map(shape), expected, name);
    }
  }
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
  const { label, ko, en } = split({
    ...CASES["promo-member"],
    promoName: "Manager's Weekend Special Extravaganza Sale Event 123456789",
    nameKo: ABSURD_KO,
    nameEn: ABSURD_EN,
    promoRange: "the whole of the month of September and the first week of October",
    uom: "100g of drained weight",
    barcode: "9300001028165930000102816593000010281659300001028165",
  });

  assertFits(head(label, "Manager's"), "promo headline");
  // Names are cut on their last row (the rows above are full, not cut).
  assertFits(ko.at(-1), "Korean name");
  assertFits(en.at(-1), "English name");
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
    const { en: rows } = split({ ...CASES[name], nameKo: ABSURD_KO, nameEn: ABSURD_EN });
    const en = elementBounds(rows.at(-1));
    assert.ok(
      en.y + en.h <= DIGIT_LINE_Y,
      `${name}: English bottom ${en.y + en.h} > ${DIGIT_LINE_Y}`,
    );
  }
});

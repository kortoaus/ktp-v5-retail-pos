// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceTag7090, getPriceTag7090Model } from "./price-tag-7090.ts";
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
  assert.ok(resolveTextSize(long) < long.size, "a long headline shrinks");
  assert.ok(resolveTextSize(long) >= long.minSize, "but not below the floor");
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
  assert.ok(zpl.includes("^FO475,628^BXN,5,200^FH^FD9300001028165^FS"), zpl);
  assert.equal(zpl.split("9300001028165").length - 1, 3);
});

test("nothing lands outside 560 × 720, in any of the four cases", () => {
  const [pageW, pageH] = MEDIA["7090"].dots;
  const inputs = [
    ...Object.values(CASES),
    { ...CASES["promo-member"], priceCents: 129999, wasPriceCents: 149999, uom: "100g" },
    {
      ...CASES["normal-guest"],
      nameKo: "아주 긴 한글 상품명 테스트 모듬사시미 특선 플래터",
      nameEn: "A Very Long English Product Name That Has To Wrap Twice",
    },
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

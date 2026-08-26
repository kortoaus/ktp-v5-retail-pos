// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildIngredientLabel58100 } from "./ingredient-58100.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

const SAMPLE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  packedOnIso: "2026-08-26",
  usedByIso: "2026-08-27",
  weightText: "0.512",
  unit: "kg",
  unitPriceText: "$55.00",
  wasUnitPriceText: "$62.00",
  totalText: "$28.16",
  ingredients:
    "Salmon, Tuna, Kingfish, Rice, Vinegar, Sugar, Salt, Wasabi, Soy Sauce (Water, Soybean, Wheat, Salt), Seaweed, Sesame Oil, Preservative (202)",
  barcode: { kind: "ean13", data12: "200000102816" },
};

const QR = {
  ...SAMPLE,
  barcode: { kind: "pp", qrData: '00:{"00":2,"01":"9300001","04":512}' },
};

test("the legacy coordinates survived the move to 464 dots", () => {
  const zpl = renderLabel(buildIngredientLabel58100(SAMPLE));

  assert.ok(zpl.includes("^PW464") && zpl.includes("^LL800"));
  // name block: three lines of 50 from y130
  assert.ok(/\^FO10,130\^A@N,\d+,\d+,E:NOTOKRB\.TTF\^FB444,3,0,L,0/.test(zpl), zpl);
  // price row on the pre-printed line, dates under it, barcode beside them
  assert.ok(/\^FO20,565\^A@N/.test(zpl), "weight at 20,565");
  assert.ok(/\^FO140,565\^A@N/.test(zpl), "unit price at 140,565");
  assert.ok(zpl.includes("^FO270,561"), "total at 270,561");
  assert.ok(zpl.includes("^FO15,665"), "packed-on at 15,665");
  assert.ok(zpl.includes("^FO135,665"), "use-by at 135,665");
  assert.ok(zpl.includes("^FO240,638^BY2,3,70^BEN,70,Y,N^FH^FD200000102816^FS"));
  assert.ok(!zpl.includes("^FB480"), "no store footer on this label");
});

test("the total is Black and the ingredients Medium", () => {
  const zpl = renderLabel(buildIngredientLabel58100(SAMPLE));
  const totalLine = zpl.split("\n").find((line) => line.includes("$28.16"));
  assert.match(totalLine, /E:NOTOKRBK\.TTF/);

  const ingredientLine = zpl.split("\n").find((line) => line.includes("Kingfish"));
  assert.match(ingredientLine, /E:NOTOKRM\.TTF/);
  assert.match(ingredientLine, /\^A@N,20,18/);
});

test("the was-price rule is as wide as the shrunk text, not the asked size", () => {
  const label = buildIngredientLabel58100(SAMPLE);
  const was = label.elements.find((el) => el.kind === "text" && el.text.startsWith("was "));
  const rule = label.elements.find((el) => el.kind === "line" && el.x === was.x - 2);

  assert.ok(was && rule, "a was-price and its rule");
  assert.ok(rule.w <= was.width, `rule ${rule.w} must stay inside the column ${was.width}`);
  assert.equal(rule.y, was.y + Math.round(was.size / 2));
});

test("the QR variant keeps the ingredient paragraph clear of the symbol", () => {
  const label = buildIngredientLabel58100(QR);
  const zpl = renderLabel(label);

  assert.ok(zpl.includes("^FO280,300^BQN,2,3^"), zpl);
  assert.ok(!zpl.includes("^BEN"), "no linear barcode on the QR variant");

  const paragraph = label.elements.find((el) => el.kind === "text" && el.lines > 3);
  assert.ok(paragraph.x + paragraph.width <= 280, "paragraph stops at the QR's left edge");
});

test("a non-kilogram unit strikes the pre-printed kg and names the real unit", () => {
  const zpl = renderLabel(buildIngredientLabel58100({ ...SAMPLE, unit: "100g" }));
  assert.ok(zpl.includes("^FO15,522^GB25,2,2^FS"));
  assert.ok(zpl.includes("^FO140,522^GB30,2,2^FS"));
  assert.ok(zpl.includes("^FO180,507^A@N,20,18,E:NOTOKRM.TTF^FH^FD$/100g^FS"));

  const kg = renderLabel(buildIngredientLabel58100(SAMPLE));
  assert.ok(!kg.includes("^FO15,522"), "kilogram stock needs no correction");
});

test("nothing lands outside 464 × 800", () => {
  const [pageW, pageH] = MEDIA["58100"].dots;
  for (const input of [SAMPLE, QR, { ...SAMPLE, wasTotalText: "$31.74", ingredients: null }]) {
    for (const el of buildIngredientLabel58100(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("dbg rides through", () => {
  assert.equal(buildIngredientLabel58100(SAMPLE, { dbg: true }).dbg, true);
});

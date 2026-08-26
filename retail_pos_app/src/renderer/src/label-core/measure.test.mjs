// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  clamp,
  code128Modules,
  estimateBarcodeWidth,
  estimateDataMatrixSize,
  estimateQrSize,
  fitSize,
  textEm,
  textWidth,
} from "./measure.ts";

test("hangul counts as a full em, latin and digits as fractions", () => {
  assert.equal(textEm("가"), 1);
  assert.equal(textEm("가나다"), 3);
  assert.equal(textEm("a"), 0.55);
  assert.equal(textEm("5"), 0.58);
  assert.equal(textEm(" "), 0.3);
  assert.equal(Math.round(textEm("가 a5") * 100), 243); // 1 + .3 + .55 + .58
});

test("textWidth scales the em advance by the cell height", () => {
  assert.equal(textWidth("가나다", 30), 90);
  assert.equal(textWidth("", 30), 0);
});

test("fitSize keeps the asked size when the text already fits", () => {
  // "가나다" at 30 is 90 dots wide, well inside 200.
  assert.equal(fitSize("가나다", 200, 30, 10), 30);
});

test("fitSize shrinks to the largest size that fits", () => {
  // 3 em of text in 90 dots -> 30; in 89 dots -> 29.
  assert.equal(fitSize("가나다", 90, 40, 10), 30);
  assert.equal(fitSize("가나다", 89, 40, 10), 29);
});

test("fitSize never goes below minSize, clipped text beating illegible text", () => {
  assert.equal(fitSize("가나다라마바사아자차카타파하", 40, 40, 12), 12);
});

test("fitSize survives an empty string and a zero width", () => {
  assert.equal(fitSize("", 100, 24, 10), 24);
  assert.equal(fitSize("가", 0, 24, 10), 24);
});

test("clamp bounds both ways", () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(0, 1, 10), 1);
  assert.equal(clamp(99, 1, 10), 10);
});

test("symbol width estimates follow the module counts", () => {
  assert.equal(estimateBarcodeWidth("ean13", "930000000011", 2), 190);
  assert.equal(code128Modules("ABC"), 11 * 5 + 13);
  assert.equal(estimateBarcodeWidth("code128", "ABC", 2), (11 * 5 + 13) * 2);
  assert.equal(estimateQrSize(4), 116);
  assert.equal(estimateDataMatrixSize(5), 80);
});

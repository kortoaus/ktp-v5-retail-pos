// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  clamp,
  code128Modules,
  estimateLines,
  estimateBarcodeWidth,
  estimateDataMatrixSize,
  estimateQrSize,
  fitSize,
  qrModules,
  textEm,
  textWidth,
  utf8Length,
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

test("estimateLines counts what a block will wrap to, and stops at the cap", () => {
  // One short latin word at 20 dots needs ~44 of the 200 available.
  assert.equal(estimateLines("Sashimi", 20, 200), 1);
  assert.equal(estimateLines("Assorted Sashimi Platter Deluxe Family Size", 20, 200), 3);
  assert.equal(estimateLines("Assorted Sashimi Platter Deluxe Family Size", 20, 200, 2), 2);

  // Hangul is full-width and has no spaces to break on, so it breaks per glyph.
  assert.equal(estimateLines("모듬사시미", 20, 200), 1);
  assert.equal(estimateLines("모듬사시미 특선 플래터 세트 대용량", 20, 100), 5);

  assert.equal(estimateLines("", 20, 200), 0);
  assert.equal(estimateLines("Sashimi", 20, 0), 0);
});

// ---------------------------------------------------------------------------
// QR versioning — EC level L, byte mode, which is what the emitter sends
// ---------------------------------------------------------------------------

test("a qr with no payload given keeps the version-3 assumption", () => {
  assert.equal(qrModules(), 29);
  assert.equal(estimateQrSize(4), 116);
  assert.equal(estimateQrSize(2), 58);
});

test("the full PP payload is version 7 — 45 modules, 90 dots at mag 2", () => {
  // 154 bytes is v7's byte-mode capacity at level L, so 147 fits it with room.
  assert.equal(qrModules(147), 45);
  assert.equal(estimateQrSize(2, 147), 90);

  // The version boundaries either side of it.
  assert.equal(qrModules(134), 41, "v6 holds 134");
  assert.equal(qrModules(135), 45, "135 spills into v7");
  assert.equal(qrModules(154), 45, "v7 holds 154");
  assert.equal(qrModules(155), 49, "155 spills into v8");
});

test("the version table walks up from 21 modules in steps of four", () => {
  assert.equal(qrModules(1), 21);
  assert.equal(qrModules(17), 21);
  assert.equal(qrModules(18), 25);
  assert.equal(qrModules(53), 29);
  assert.equal(qrModules(0), 21, "an empty payload is still a symbol");

  // Past the table's v10 it clamps rather than throwing — a small debug box
  // beats a lost label.
  assert.equal(qrModules(271), 57);
  assert.equal(qrModules(9999), 57);
});

test("utf8Length counts bytes, not code points — the printer counts bytes", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("가"), 3);
  assert.equal(utf8Length("가나다"), 9);
  assert.equal(utf8Length(""), 0);
  assert.equal(utf8Length("\u00e9"), 2);
  assert.equal(utf8Length("\u{1f600}"), 4);

  // Hangul in a payload pushes the version up, which is the point of counting.
  assert.equal(qrModules(utf8Length("가".repeat(50))), 45);
});

// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  ELLIPSIS,
  FIT_SAFETY,
  clamp,
  clipToBlock,
  clipToWidth,
  wrapToWidths,
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
  assert.equal(textEm("A"), 0.63);
  assert.equal(textEm("5"), 0.58);
  assert.equal(textEm(" "), 0.3);
  assert.equal(Math.round(textEm("가 a5") * 100), 243); // 1 + .3 + .55 + .58
  assert.equal(Math.round(textEm("가 A5") * 100), 251); // 1 + .3 + .63 + .58
});

test("capitals are their own class — a caps name is wider than the same lower-case one", () => {
  assert.ok(textEm("SALMON") > textEm("salmon"));
  // Exactly the ratio difference, six glyphs of it.
  assert.equal(Math.round((textEm("SALMON") - textEm("salmon")) * 100), 48);

  // Punctuation is not a capital: brackets keep the plain Latin ratio.
  assert.equal(textEm("(A)"), 0.55 + 0.63 + 0.55);
});

/**
 * The 2026-08-26 ZD421 measurement these ratios were fitted to: in a 450-dot
 * block at size 30, Noto Sans KR Bold ran out of room at ≈27 mixed-case
 * characters and at ≈24 UPPERCASE characters. Both are asserted to land within
 * 5% of 450 — the ratios are a safety margin, not a metric, so "close" is the
 * strongest claim available.
 */
test("the measured 450-dot capacity at size 30: ~27 mixed, ~24 caps", () => {
  const mixed = "Assorted Sashimi Platter XL"; // 27 chars
  const caps = "A".repeat(24);

  assert.equal(mixed.length, 27);
  for (const [what, width] of [
    ["mixed", textWidth(mixed, 30)],
    ["caps", textWidth(caps, 30)],
  ]) {
    assert.ok(Math.abs(width - 450) <= 450 * 0.05, `${what} measured ${width}, expected ~450`);
  }
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

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------
//
// `^FB` does not truncate: given more text than the block holds it prints the
// overflow *on top of* the last line it was given. A 70 × 30 tag came back from
// the 2026-08-28 hardware run reading `Botttlashait.RonDreShoup`. Everything
// below exists so that cannot reach a printer again.

test("the ellipsis is measured wider than a letter, narrower than an em", () => {
  // Noto KR advances U+2026 like a proportional glyph; 1.0 wasted a character
  // of every clip (owner hardware round 2026-08-28), a letter-width would let
  // the marker overflow the block it pays for.
  assert.equal(textEm(ELLIPSIS), 0.6);
  assert.ok(FIT_SAFETY > 0.9 && FIT_SAFETY < 1, "a margin, not a redesign");
});

test("text that fits is returned untouched", () => {
  // No safety factor is charged to a string that already fits: clipping a date
  // that prints correctly today would be a worse label, not a safer one.
  assert.equal(clipToWidth("Assorted Sashimi", 24, 400), "Assorted Sashimi");
  assert.equal(clipToBlock("27/08", 24, 70), "27/08");
  assert.equal(clipToBlock("가나다라마바사", 40, 160, 2), "가나다라마바사");
});

test("text that does not fit comes back cut, marked, and measurably fitting", () => {
  const long = "Hondashi Bonito Soup Stock Bottle Katsuo Dashi";

  const cut = clipToWidth(long, 18, 252);
  assert.ok(cut.length < long.length, "something was dropped");
  assert.ok(cut.endsWith(ELLIPSIS), `"${cut}" carries no marker`);
  assert.ok(long.startsWith(cut.slice(0, -1)), "and what is left is a prefix of the original");
  assert.ok(textWidth(cut, 18) <= 252, `"${cut}" still overflows`);

  // `clipToWidth` is raw geometry — the margin belongs to `clipToBlock`, which
  // spends it only on a string it has to cut anyway (see FIT_SAFETY).
  const block = clipToBlock(long, 18, 252);
  assert.ok(block.endsWith(ELLIPSIS));
  assert.ok(textEm(block) * 18 <= 252 * FIT_SAFETY, "the cut keeps the safety margin");
  assert.ok(block.length <= cut.length, "which costs it a character, not a redesign");
});

test("a wrapped block is cut by rows as well as by width", () => {
  // 20 hangul at 40 dots is 800 dots of advance; two 160-dot rows hold eight.
  const cut = clipToBlock("가".repeat(20), 40, 160, 2);
  assert.ok(cut.endsWith(ELLIPSIS));
  assert.ok(textWidth(cut, 40) <= 160 * 2);
  assert.ok(estimateLines(cut, 40, 160, 3) <= 2, "and it really wraps into two rows");
});

test("a trailing space is dropped before the marker", () => {
  const cut = clipToWidth("Aaaa bbbb cccc dddd", 20, 120);
  assert.ok(!cut.includes(" " + ELLIPSIS), `"${cut}" kept its trailing space`);
});

test("a block too small for anything degrades rather than throwing", () => {
  assert.equal(clipToWidth("Assorted", 40, 10), "");
  assert.equal(clipToWidth("", 24, 100), "");
  // A zero-width block is a template that declared no block; nothing to fit to.
  assert.equal(clipToBlock("Assorted", 24, 0), "Assorted");
});

// ---------------------------------------------------------------------------
// Wrapping onto rows of different widths
// ---------------------------------------------------------------------------

test("a name wraps onto rows that need not be the same width", () => {
  // The 70 × 30 tag's third row runs beside the barcode digits, so it is narrow;
  // one `^FB` block cannot express that, which is why this exists.
  const rows = wrapToWidths("Assorted Sashimi Platter Special", 26, [424, 424, 252]);
  assert.ok(rows.length >= 1 && rows.length <= 3);
  rows.forEach((row, i) => {
    assert.ok(textEm(row) * 26 <= [424, 424, 252][i], `row ${i}: "${row}" overflows`);
  });
  assert.equal(rows.join(" "), "Assorted Sashimi Platter Special", "no word is lost");
});

test("hangul breaks between characters, latin between words", () => {
  // Same rule `estimateLines` uses, and the same rule `^FB` follows.
  assert.deepEqual(wrapToWidths("가나다라", 40, [80, 80]), ["가나", "다라"]);
  assert.deepEqual(wrapToWidths("aa bb cc", 40, [1000]), ["aa bb cc"]);
});

test("what will not fit stays on the last row, for the caller to cut", () => {
  // Dropping it silently is how a name ends up truncated with nothing to say so.
  const rows = wrapToWidths("가".repeat(10), 40, [80]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0], "가".repeat(10), "the remainder is kept, not lost");
  assert.ok(clipToBlock(rows[0], 40, 80).endsWith(ELLIPSIS), "and the clip marks it");
});

test("a token wider than its row still gets a row of its own", () => {
  const rows = wrapToWidths("가나다라마 bb", 40, [80, 80]);
  assert.equal(rows[0], "가나다라마", "an unbreakable token is not dropped");
  assert.equal(rows[1], "bb");
});

test("no text, no rows", () => {
  assert.deepEqual(wrapToWidths("   ", 26, [424]), []);
  assert.deepEqual(wrapToWidths("name", 26, []), []);
});

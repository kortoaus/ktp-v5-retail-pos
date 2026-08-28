// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TEXT_BOTTOM,
  FREE_TEXT_CONTENT_W,
  FREE_TEXT_LEADING_GAP,
  FREE_TEXT_PAD,
  FREE_TEXT_SIZE_DOTS,
  FREE_TEXT_WRAP_W,
  buildFreeTextLabels6040,
  freeTextRows,
  wrapFreeTextLine,
} from "./free-text-6040.ts";
import { MEDIA } from "../media.ts";
import { textEm } from "../measure.ts";
import { mergeJobs } from "../merge.ts";
import { renderLabel } from "../zpl.ts";

const S = FREE_TEXT_SIZE_DOTS.S; // 24
const M = FREE_TEXT_SIZE_DOTS.M; // 34
const L = FREE_TEXT_SIZE_DOTS.L; // 48

/** `n` short lines, all the same size/weight — the pagination fixture. */
function lines(n, size = "M", weight = "M", label = "Row") {
  return Array.from({ length: n }, (_, i) => ({ text: `${label} ${i + 1}`, size, weight }));
}

/** Every text element of every page, flattened, in print order. */
function allText(pages) {
  return pages.flatMap((page) => page.elements.filter((el) => el.kind === "text"));
}

/**
 * Rows that fit one page at `size`, derived rather than hard-coded so the
 * expectation moves with the constants instead of silently going stale.
 */
function rowsPerPage(size) {
  let y = FREE_TEXT_PAD;
  let n = 0;
  while (y + size <= FREE_TEXT_BOTTOM) {
    n += 1;
    y += size + FREE_TEXT_LEADING_GAP;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test("the label is the 60 × 40 media and the column is 448 dots", () => {
  assert.deepEqual(MEDIA["6040"].dots, [480, 320]);
  assert.equal(FREE_TEXT_CONTENT_W, 480 - 2 * FREE_TEXT_PAD);
  assert.equal(FREE_TEXT_CONTENT_W, 448);
  assert.equal(FREE_TEXT_BOTTOM, 320 - FREE_TEXT_PAD);
});

test("the first row sits at the top-left padding and every row is a 448 block", () => {
  const [page] = buildFreeTextLabels6040(lines(3));

  assert.equal(page.media, "6040");
  for (const el of page.elements) {
    assert.equal(el.x, FREE_TEXT_PAD);
    assert.equal(el.width, FREE_TEXT_CONTENT_W);
    assert.equal(el.lines, 1);
    assert.equal(el.align, "L");
  }
  assert.equal(page.elements[0].y, FREE_TEXT_PAD);
});

test("leading is size + 6, per row, at that row's own size", () => {
  const pages = buildFreeTextLabels6040([
    { text: "small", size: "S", weight: "M" },
    { text: "medium", size: "M", weight: "M" },
    { text: "large", size: "L", weight: "M" },
  ]);
  const [a, b, c] = allText(pages);

  assert.equal(a.y, FREE_TEXT_PAD);
  assert.equal(b.y, a.y + S + FREE_TEXT_LEADING_GAP);
  assert.equal(c.y, b.y + M + FREE_TEXT_LEADING_GAP);
});

// ---------------------------------------------------------------------------
// Pagination — the whole reason this template returns an array
// ---------------------------------------------------------------------------

test("a tall input becomes N pages, and no row ever crosses the bottom padding", () => {
  const perPage = rowsPerPage(M);
  assert.equal(perPage, 7, "34-dot rows on a 320-dot label");

  const pages = buildFreeTextLabels6040(lines(20));

  assert.equal(pages.length, Math.ceil(20 / perPage));
  assert.equal(allText(pages).length, 20, "no row is dropped — pagination, not clipping");
  assert.equal(pages[0].elements.length, perPage);

  for (const page of pages) {
    for (const el of page.elements) {
      assert.ok(
        el.y + el.size <= FREE_TEXT_BOTTOM,
        `row at y=${el.y} size=${el.size} runs past ${FREE_TEXT_BOTTOM}`,
      );
      assert.ok(el.y >= FREE_TEXT_PAD);
    }
  }
});

test("page capacity follows the row size — bigger text, fewer rows a page", () => {
  const small = buildFreeTextLabels6040(lines(30, "S"));
  const large = buildFreeTextLabels6040(lines(30, "L"));

  assert.equal(small[0].elements.length, rowsPerPage(S));
  assert.equal(large[0].elements.length, rowsPerPage(L));
  assert.ok(
    small[0].elements.length > large[0].elements.length,
    "S must fit more rows a page than L",
  );
  assert.ok(large.length > small.length, "and therefore need more pages");
});

test("every page restarts at the top padding", () => {
  const pages = buildFreeTextLabels6040(lines(20));
  for (const page of pages) assert.equal(page.elements[0].y, FREE_TEXT_PAD);
});

test("a wrapped line is paginated by its rows, not kept whole", () => {
  // One long Korean line at L wraps to more rows than an L page holds, so it
  // has to split across pages — a row is the unit of pagination, not a line.
  const long = "가".repeat(rowsPerPage(L) * 12);
  const pages = buildFreeTextLabels6040([{ text: long, size: "L", weight: "B" }]);

  assert.ok(pages.length > 1, `expected a split, got ${pages.length} page(s)`);
  assert.equal(
    allText(pages)
      .map((el) => el.text)
      .join(""),
    long,
    "the text survives the split intact",
  );
});

// ---------------------------------------------------------------------------
// Blank lines
// ---------------------------------------------------------------------------

test("a blank line is a spacing row — one leading at its own size, nothing printed", () => {
  const pages = buildFreeTextLabels6040([
    { text: "A", size: "M", weight: "M" },
    { text: "", size: "L", weight: "M" },
    { text: "B", size: "M", weight: "M" },
  ]);
  const [a, b] = allText(pages);

  assert.equal(allText(pages).length, 2, "the blank line prints no field");
  assert.equal(a.y, FREE_TEXT_PAD);
  assert.equal(b.y, a.y + (M + FREE_TEXT_LEADING_GAP) + (L + FREE_TEXT_LEADING_GAP));
});

test("the size of a blank line is how the operator picks the gap", () => {
  const gapFor = (size) => {
    const [page] = buildFreeTextLabels6040([
      { text: "A", size: "S", weight: "M" },
      { text: "   ", size, weight: "M" },
      { text: "B", size: "S", weight: "M" },
    ]);
    const [a, b] = page.elements;
    return b.y - a.y;
  };

  assert.equal(gapFor("S"), S + FREE_TEXT_LEADING_GAP + (S + FREE_TEXT_LEADING_GAP));
  assert.equal(gapFor("L"), S + FREE_TEXT_LEADING_GAP + (L + FREE_TEXT_LEADING_GAP));
  assert.ok(gapFor("L") > gapFor("M") && gapFor("M") > gapFor("S"));
});

test("whitespace-only text is a blank row; a blank-only input prints nothing", () => {
  assert.deepEqual(freeTextRows([{ text: "  \t ", size: "M", weight: "M" }]), [
    { text: "", size: M, weight: "M" },
  ]);
  assert.deepEqual(buildFreeTextLabels6040([{ text: "", size: "M", weight: "M" }]), []);
  assert.deepEqual(
    buildFreeTextLabels6040(lines(4).map((line) => ({ ...line, text: "" }))),
    [],
  );
});

test("empty input is no label at all, not one empty label", () => {
  assert.deepEqual(buildFreeTextLabels6040([]), []);
  assert.deepEqual(buildFreeTextLabels6040([], { copies: 3, dbg: true }), []);
});

// ---------------------------------------------------------------------------
// Explicit newlines
// ---------------------------------------------------------------------------

test("an embedded \\n splits one entry into several rows at the same size/weight", () => {
  const [page] = buildFreeTextLabels6040([
    { text: "첫째 줄\n둘째 줄\n셋째 줄", size: "M", weight: "B" },
  ]);

  assert.deepEqual(
    page.elements.map((el) => el.text),
    ["첫째 줄", "둘째 줄", "셋째 줄"],
  );
  for (const el of page.elements) {
    assert.equal(el.size, M);
    assert.equal(el.weight, "B");
  }
  assert.deepEqual(
    page.elements.map((el) => el.y),
    [16, 16 + (M + FREE_TEXT_LEADING_GAP), 16 + 2 * (M + FREE_TEXT_LEADING_GAP)],
  );
});

test('"a\\n\\nb" puts a spacing row between the two — one leading, nothing printed', () => {
  assert.deepEqual(freeTextRows([{ text: "a\n\nb", size: "M", weight: "M" }]), [
    { text: "a", size: M, weight: "M" },
    { text: "", size: M, weight: "M" },
    { text: "b", size: M, weight: "M" },
  ]);

  const [page] = buildFreeTextLabels6040([{ text: "a\n\nb", size: "M", weight: "M" }]);
  const [a, b] = page.elements;

  assert.equal(page.elements.length, 2, "the blank segment prints no field");
  assert.equal(b.y - a.y, 2 * (M + FREE_TEXT_LEADING_GAP), "two leadings apart");
});

test("leading and trailing newlines are spacing rows too", () => {
  assert.deepEqual(
    freeTextRows([{ text: "\nmid\n", size: "S", weight: "M" }]).map((r) => r.text),
    ["", "mid", ""],
  );

  // The leading gap pushes the printed row down by exactly one S leading; the
  // trailing one prints nothing at all.
  const [page] = buildFreeTextLabels6040([{ text: "\nmid\n", size: "S", weight: "M" }]);
  assert.equal(page.elements.length, 1);
  assert.equal(page.elements[0].y, FREE_TEXT_PAD + S + FREE_TEXT_LEADING_GAP);
});

test("\\r\\n and a bare \\r break the same way \\n does", () => {
  const texts = (raw) => freeTextRows([{ text: raw, size: "M", weight: "M" }]).map((r) => r.text);

  assert.deepEqual(texts("a\r\nb"), ["a", "b"]);
  assert.deepEqual(texts("a\rb"), ["a", "b"]);
  assert.deepEqual(texts("a\r\n\r\nb"), ["a", "", "b"]);
});

test("an explicit break is honoured even where the text would have fitted one row", () => {
  // "a b" fits 448 dots at any size — the two rows exist only because the
  // operator asked for them.
  const rows = freeTextRows([{ text: "a\nb", size: "S", weight: "M" }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(wrapFreeTextLine("a b", S), ["a b"], "…and it would have fitted");
});

test("each segment wraps independently — a long segment still folds", () => {
  const long = "가".repeat(30);
  const rows = freeTextRows([{ text: `짧게\n${long}`, size: "M", weight: "M" }]);

  assert.equal(rows[0].text, "짧게");
  assert.ok(rows.length > 2, "the long segment wrapped");
  assert.equal(rows.slice(1).map((r) => r.text).join(""), long);
  for (const row of rows) assert.ok(textEm(row.text) * row.size <= FREE_TEXT_WRAP_W);
});

test("a multiline entry paginates across labels like any other rows", () => {
  const perPage = rowsPerPage(M);
  const text = Array.from({ length: perPage * 2 + 1 }, (_, i) => `Row ${i + 1}`).join("\n");
  const pages = buildFreeTextLabels6040([{ text, size: "M", weight: "M" }]);

  assert.equal(pages.length, 3, "one entry, three labels");
  assert.equal(allText(pages).length, perPage * 2 + 1);
  assert.equal(pages[0].elements.length, perPage);
  assert.equal(pages[2].elements[0].text, `Row ${perPage * 2 + 1}`);
  for (const page of pages) {
    assert.equal(page.elements[0].y, FREE_TEXT_PAD);
    for (const el of page.elements) assert.ok(el.y + el.size <= FREE_TEXT_BOTTOM);
  }
});

test("a newline never reaches the printer — the emitter would drop it", () => {
  const [page] = buildFreeTextLabels6040([{ text: "a\nb", size: "M", weight: "M" }]);
  const zpl = renderLabel(page);

  assert.equal(zpl.split("^FD").length - 1, 2, "two fields, not one");
  for (const el of page.elements) assert.ok(!el.text.includes("\n"));
});

test("an entry of nothing but newlines prints nothing at all", () => {
  assert.deepEqual(buildFreeTextLabels6040([{ text: "\n\n\n", size: "M", weight: "M" }]), []);
});

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

test("every produced row measurably fits the wrap column", () => {
  const pages = buildFreeTextLabels6040([
    { text: "The quick brown fox jumps over the lazy dog again and again", size: "M", weight: "M" },
    { text: "오늘 준비한 반찬은 냉장 보관하시고 3일 이내에 드세요", size: "L", weight: "B" },
    { text: "SUPPLIER: KORTOAUS PTY LTD — BATCH 2026-08-28 — LOT 4471", size: "S", weight: "BK" },
  ]);

  for (const el of allText(pages)) {
    assert.ok(
      textEm(el.text) * el.size <= FREE_TEXT_WRAP_W,
      `row "${el.text}" measures ${textEm(el.text) * el.size} > ${FREE_TEXT_WRAP_W}`,
    );
  }
});

test("Korean wraps between characters — no spaces to break on", () => {
  const text = "냉장보관필수해동후재냉동금지";
  const rows = wrapFreeTextLine(text, L);

  assert.ok(rows.length > 1, "a 14-syllable line at 48 dots does not fit 448");
  assert.equal(rows.join(""), text, "nothing is lost or duplicated");
  for (const row of rows) assert.ok(textEm(row) * L <= FREE_TEXT_WRAP_W);
});

test("a mixed Korean line wraps and still reassembles", () => {
  const text = "유통기한 2026-09-01 · 원산지 대한민국 · 보관방법 0~4℃ 냉장";
  const rows = wrapFreeTextLine(text, M);

  assert.ok(rows.length > 1);
  assert.equal(rows.join(" "), text, "space-broken rows rejoin with the space");
});

test("one token wider than the column is hard-broken, never left over-wide", () => {
  // `wrapToWidths` alone would leave this token alone on its row, over-wide —
  // and ^FB would then print it on top of itself. The character break is what
  // stops that; see the template header.
  const token = "A".repeat(40);
  const rows = wrapFreeTextLine(`GO ${token}`, L);

  assert.ok(rows.length >= 3, `expected the token to break, got ${rows.length} row(s)`);
  assert.equal(rows[0], "GO");
  assert.equal(rows.slice(1).join(""), token);
  for (const row of rows) assert.ok(textEm(row) * L <= FREE_TEXT_WRAP_W);
});

test("wrapFreeTextLine returns nothing for blank input", () => {
  assert.deepEqual(wrapFreeTextLine("", M), []);
  assert.deepEqual(wrapFreeTextLine("   \n ", M), []);
  assert.deepEqual(wrapFreeTextLine("x", 0), []);
});

// ---------------------------------------------------------------------------
// ZPL
// ---------------------------------------------------------------------------

test("per-line size and weight reach the ZPL font command", () => {
  const [page] = buildFreeTextLabels6040([
    { text: "black large", size: "L", weight: "BK" },
    { text: "bold medium", size: "M", weight: "B" },
    { text: "regular small", size: "S", weight: "M" },
  ]);
  const zpl = renderLabel(page);

  // ^A@N,<height>,<width = round(height * 0.9)>,<font file>
  assert.ok(zpl.includes("^A@N,48,43,E:NOTOKRBK.TTF"), "L / BK");
  assert.ok(zpl.includes("^A@N,34,31,E:NOTOKRB.TTF"), "M / B");
  assert.ok(zpl.includes("^A@N,24,22,E:NOTOKRM.TTF"), "S / M");
  assert.ok(zpl.includes("^PW480") && zpl.includes("^LL320"));
  assert.ok(zpl.includes(`^FO${FREE_TEXT_PAD},${FREE_TEXT_PAD}^A@N,48,43`), "first row placed");
  assert.ok(zpl.includes(`^FB${FREE_TEXT_CONTENT_W},1,0,L,0`), "the 448-dot block");
});

test("Korean reaches the printer as UTF-8, and ZPL metacharacters are escaped", () => {
  const [page] = buildFreeTextLabels6040([
    // `^` and `~` start commands and `_` is ^FH's hex introducer — free text is
    // exactly where an operator will type one of the three by accident.
    { text: "냉장 ^ ~ _ 보관", size: "M", weight: "B" },
  ]);
  const zpl = renderLabel(page);

  assert.ok(zpl.includes("^CI28"), "UTF-8 mode — hangul passes through byte for byte");
  assert.ok(zpl.includes("^FH^FD냉장 _5E _7E _5F 보관^FS"));
});

test("pages merge into one job — one ^XA per page", () => {
  const pages = buildFreeTextLabels6040(lines(20));
  const job = mergeJobs(pages);

  assert.equal(job.split("^XA").length - 1, pages.length);
  assert.equal(job.split("^XZ").length - 1, pages.length);
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

test("dbg and copies ride through onto every page", () => {
  const pages = buildFreeTextLabels6040(lines(20), { dbg: true, copies: 3 });

  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.equal(page.dbg, true);
    assert.equal(page.copies, 3);
    assert.ok(renderLabel(page).includes("^PQ3"));
  }
});

test("no options means no copies field and no debug outlines", () => {
  const [page] = buildFreeTextLabels6040(lines(2));

  assert.equal(page.dbg, false);
  assert.equal(page.copies, undefined);
  assert.ok(!renderLabel(page).includes("^PQ"));
  assert.ok(!renderLabel(page).includes("^GB"), "dbg off draws no outline");
});

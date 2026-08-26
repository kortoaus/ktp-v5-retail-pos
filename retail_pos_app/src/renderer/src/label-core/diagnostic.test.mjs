// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { buildDiagnosticLabel, DIAGNOSTIC_EAN13 } from "./diagnostic.ts";
import { MEDIA, MEDIA_IDS } from "./media.ts";
import { textWidth } from "./measure.ts";
import { elementBounds, renderLabel, resolveTextSize } from "./zpl.ts";

test("every element kind appears, hangul in all three weights", () => {
  const { elements } = buildDiagnosticLabel("6040");
  const kinds = elements.map((el) => el.kind);

  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ["barcode", "box", "datamatrix", "line", "qr", "text"],
  );
  assert.deepEqual(
    elements.filter((el) => el.kind === "text").map((el) => el.weight),
    ["M", "B", "BK", "M"],
  );
  assert.deepEqual(
    elements.filter((el) => el.kind === "barcode").map((el) => el.sym),
    ["ean13", "code128"],
  );
  // Korean has to be on the label or the fonts prove nothing.
  assert.equal(
    elements.some((el) => el.kind === "text" && /[가-힣]/.test(el.text)),
    true,
  );
});

test("the shrink row really shrinks on every media", () => {
  for (const id of MEDIA_IDS) {
    const shrinker = buildDiagnosticLabel(id).elements.find(
      (el) => el.kind === "text" && el.shrink,
    );
    assert.ok(shrinker, `${id} has a shrink row`);
    assert.ok(
      resolveTextSize(shrinker) < shrinker.size,
      `${id}: ${resolveTextSize(shrinker)} should be below the asked ${shrinker.size}`,
    );
    assert.ok(resolveTextSize(shrinker) >= shrinker.minSize, `${id} respects minSize`);
  }
});

test("nothing overflows the media, on any of the five", () => {
  for (const id of MEDIA_IDS) {
    const [pageW, pageH] = MEDIA[id].dots;
    for (const el of buildDiagnosticLabel(id).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${id} ${el.kind} starts on the label`);
      assert.ok(
        box.x + box.w <= pageW,
        `${id} ${el.kind} right edge ${box.x + box.w} > ${pageW}`,
      );
      assert.ok(
        box.y + box.h <= pageH,
        `${id} ${el.kind} bottom edge ${box.y + box.h} > ${pageH}`,
      );
    }
  }
});

test("fixed-size text rows fit their block width without wrapping", () => {
  for (const id of MEDIA_IDS) {
    for (const el of buildDiagnosticLabel(id).elements) {
      if (el.kind !== "text" || el.shrink) continue;
      assert.ok(
        textWidth(el.text, el.size) <= el.width,
        `${id}: "${el.text}" at ${el.size} needs ${textWidth(el.text, el.size)} of ${el.width}`,
      );
    }
  }
});

test("ean13 carries 12 digits — the printer adds the check digit", () => {
  assert.match(DIAGNOSTIC_EAN13, /^\d{12}$/);
});

test("dbg is off unless asked, and then outlines every element", () => {
  const plain = buildDiagnosticLabel("6040");
  assert.equal(plain.dbg, false);

  const debug = buildDiagnosticLabel("6040", { dbg: true });
  assert.equal(debug.dbg, true);

  const outlines = (label) =>
    renderLabel(label)
      .split("\n")
      .filter((line) => line.endsWith(",1^FS")).length;
  assert.equal(outlines(debug), debug.elements.length);
  assert.ok(outlines(plain) < outlines(debug));
});

test("copies ride through to ^PQ", () => {
  assert.equal(renderLabel(buildDiagnosticLabel("6040", { copies: 2 })).includes("^PQ2"), true);
  assert.equal(renderLabel(buildDiagnosticLabel("6040")).includes("^PQ"), false);
});

test("the rendered job is one well formed format per media", () => {
  for (const id of MEDIA_IDS) {
    const zpl = renderLabel(buildDiagnosticLabel(id));
    const [pageW, pageH] = MEDIA[id].dots;
    assert.ok(zpl.startsWith("^XA\n^CI28\n"), `${id} header`);
    assert.ok(zpl.includes(`^PW${pageW}`) && zpl.includes(`^LL${pageH}`), `${id} media`);
    assert.ok(zpl.endsWith("^XZ"), `${id} terminator`);
    assert.equal(zpl.split("^XA").length - 1, 1, `${id} single format`);
    assert.ok(zpl.includes("E:NOTOKRM.TTF"), `${id} medium face`);
    assert.ok(zpl.includes("E:NOTOKRB.TTF"), `${id} bold face`);
    assert.ok(zpl.includes("E:NOTOKRBK.TTF"), `${id} black face`);
  }
});

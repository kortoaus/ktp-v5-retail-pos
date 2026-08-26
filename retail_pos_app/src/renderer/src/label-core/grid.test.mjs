// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { GRID_MAJOR, buildGridLabel } from "./grid.ts";
import { MEDIA, MEDIA_IDS } from "./media.ts";
import { elementBounds, renderLabel } from "./zpl.ts";

test("every media gets a grid that stays on its own media", () => {
  for (const id of MEDIA_IDS) {
    const [width, height] = MEDIA[id].dots;
    const label = buildGridLabel(id);

    assert.equal(label.media, id);
    for (const el of label.elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${id}: ${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= width, `${id}: right edge ${box.x + box.w} > ${width}`);
      assert.ok(box.y + box.h <= height, `${id}: bottom ${box.y + box.h} > ${height}`);
    }
  }
});

test("the lines are labelled with the coordinates a template would type", () => {
  const zpl = renderLabel(buildGridLabel("58100"));

  assert.ok(zpl.includes("^PW464") && zpl.includes("^LL800"));
  // A full-height rule at x 440 and a full-width one at y 560, each numbered.
  assert.ok(zpl.includes("^FO440,0^GB1,800,1^FS"), zpl);
  assert.ok(zpl.includes("^FO0,560^GB464,1,1^FS"), zpl);
  assert.ok(zpl.includes("^FH^FD440^FS") && zpl.includes("^FH^FD560^FS"));
  // And the sheet says which stock it is.
  assert.ok(zpl.includes("^FH^FD58100 464x800^FS"), zpl);
});

test("the numbers use the built-in font, so an un-provisioned printer can print it", () => {
  const zpl = renderLabel(buildGridLabel("6040"));
  assert.ok(!zpl.includes("NOTOKR"), "the TTFs may not be installed yet");
  assert.ok(zpl.includes("^A0N,16,14"), zpl);
});

test("the origin carries one number, not two on top of each other", () => {
  const labels = buildGridLabel("6040").elements.filter((el) => el.kind === "text");
  assert.ok(!labels.some((el) => el.text === "0"), "x0 and y0 would overprint");
  assert.ok(labels.some((el) => el.text === String(GRID_MAJOR)));
});

test("the media's far edges are drawn, so a mis-mounted roll is visible", () => {
  const zpl = renderLabel(buildGridLabel("6040"));
  assert.ok(zpl.includes("^FO479,0^GB1,320,1^FS"), zpl);
  assert.ok(zpl.includes("^FO0,319^GB480,1,1^FS"), zpl);
});

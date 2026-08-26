// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { DPMM, MEDIA, MEDIA_IDS, getMedia, mmToDots } from "./media.ts";

test("dots are exactly mm x 8 for every media", () => {
  assert.equal(DPMM, 8);
  for (const id of MEDIA_IDS) {
    const media = MEDIA[id];
    assert.equal(media.dots[0], media.mm[0] * 8, `${id} width`);
    assert.equal(media.dots[1], media.mm[1] * 8, `${id} height`);
  }
});

test("the five media carry the sizes the id spells out", () => {
  assert.deepEqual(MEDIA_IDS, ["6040", "58100", "7030", "7090", "100100"]);
  assert.deepEqual(
    MEDIA_IDS.map((id) => [id, MEDIA[id].mm, MEDIA[id].dots]),
    [
      ["6040", [60, 40], [480, 320]],
      ["58100", [58, 100], [464, 800]],
      ["7030", [70, 30], [560, 240]],
      ["7090", [70, 90], [560, 720]],
      ["100100", [100, 100], [800, 800]],
    ],
  );
});

test("every media id maps to a record keyed by itself", () => {
  for (const id of MEDIA_IDS) {
    assert.equal(getMedia(id).id, id);
  }
});

test("getMedia refuses an unknown id instead of returning undefined", () => {
  assert.throws(() => getMedia("9999"), /unknown media/);
});

test("mmToDots rounds to whole dots", () => {
  assert.equal(mmToDots(70), 560);
  assert.equal(mmToDots(0.5), 4);
  assert.equal(mmToDots(1.06), 8);
});

// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { mergeJobs } from "./merge.ts";
import { renderLabel } from "./zpl.ts";

const A = { media: "6040", elements: [{ kind: "text", x: 0, y: 0, text: "A", size: 20 }] };
const B = { media: "7030", elements: [{ kind: "text", x: 0, y: 0, text: "B", size: 20 }] };

test("merging renders each label and keeps the order", () => {
  const merged = mergeJobs([A, B]);
  assert.equal(merged, `${renderLabel(A)}\n${renderLabel(B)}`);
  assert.equal(merged.split("^XA").length - 1, 2);
  assert.equal(merged.split("^XZ").length - 1, 2);
});

test("already rendered ZPL passes through unchanged", () => {
  assert.equal(mergeJobs([renderLabel(A), B]), `${renderLabel(A)}\n${renderLabel(B)}`);
});

test("each label keeps its own media size", () => {
  const merged = mergeJobs([A, B]);
  assert.equal(merged.includes("^PW480"), true);
  assert.equal(merged.includes("^PW560"), true);
});

test("merging nothing yields nothing, merging one is that one", () => {
  assert.equal(mergeJobs([]), "");
  assert.equal(mergeJobs([A]), renderLabel(A));
});

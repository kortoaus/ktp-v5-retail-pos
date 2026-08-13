// node --experimental-strip-types src/renderer/src/components/orders/order-print-events.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLabelPrintedCounts,
  countPicklistPrinted,
  parseLabelPrintedLineId,
} from "./order-print-events.ts";

const ev = (type, note = "") => ({
  type,
  actorType: "DEVICE",
  actorLabel: "POS-1",
  note,
  createdAt: "2026-08-13T00:00:00.000Z",
});

test("countPicklistPrinted counts only PICKLIST_PRINTED", () => {
  assert.equal(countPicklistPrinted([]), 0);
  assert.equal(
    countPicklistPrinted([
      ev("PLACED"),
      ev("PICKLIST_PRINTED"),
      ev("LABEL_PRINTED", "line:1 Cake"),
      ev("PICKLIST_PRINTED"),
    ]),
    2,
  );
});

test("parseLabelPrintedLineId parses 'line:<id> <name>' defensively", () => {
  assert.equal(parseLabelPrintedLineId("line:12 Custom Cake"), 12);
  assert.equal(parseLabelPrintedLineId("line:12"), 12);
  assert.equal(parseLabelPrintedLineId("line:0 x"), null);
  assert.equal(parseLabelPrintedLineId("line:abc"), null);
  assert.equal(parseLabelPrintedLineId("line:12x rest"), null);
  assert.equal(parseLabelPrintedLineId("lineId:12"), null);
  assert.equal(parseLabelPrintedLineId(""), null);
});

test("buildLabelPrintedCounts groups by lineId and ignores malformed notes", () => {
  const counts = buildLabelPrintedCounts([
    ev("LABEL_PRINTED", "line:11 Cake"),
    ev("LABEL_PRINTED", "line:11 Cake"),
    ev("LABEL_PRINTED", "line:22 Roll"),
    ev("LABEL_PRINTED", "garbage"),
    ev("PICKLIST_PRINTED", "line:11 not a label event"),
  ]);
  assert.equal(counts.get(11), 2);
  assert.equal(counts.get(22), 1);
  assert.equal(counts.size, 2);
});

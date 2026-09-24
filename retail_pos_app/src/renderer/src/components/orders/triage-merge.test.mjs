// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import { mergeTriageRows, patchTriageRow, replaceTriageRows } from "./triage-merge.ts";

const o = (id, status = "ACCEPTED", extra = {}) => ({ id, status, ...extra });
const ids = (rows) => rows.map((r) => r.order.id);

test("replace = server order, nothing flagged", () => {
  const rows = replaceTriageRows([o(3), o(1), o(2)]);
  assert.deepEqual(ids(rows), [3, 1, 2]);
  assert.ok(rows.every((r) => !r.gone && !r.isNew && r.goneLabel === null));
});

test("merge keeps positions even when the server reorders", () => {
  const prev = replaceTriageRows([o(1), o(2), o(3)]);
  const merged = mergeTriageRows(prev, [o(3), o(2, "SCHEDULED"), o(1)]);
  assert.deepEqual(ids(merged), [1, 2, 3]);
  assert.equal(merged[1].order.status, "SCHEDULED"); // content updated in place
});

test("rows leaving the bucket stay dimmed with a result tag", () => {
  const prev = replaceTriageRows([o(1), o(2), o(3)]);
  const merged = mergeTriageRows(prev, [o(1), o(3)], new Map([[2, "READY"]]));
  assert.deepEqual(ids(merged), [1, 2, 3]);
  assert.equal(merged[1].gone, true);
  assert.equal(merged[1].goneLabel, "→ Ready");
  assert.equal(merged[1].order.status, "READY");
  const other = mergeTriageRows(prev, [o(1), o(3)]);
  assert.equal(other[1].goneLabel, "Moved by another till");
});

test("new rows are appended at the bottom flagged NEW, and stay NEW on later merges", () => {
  const prev = replaceTriageRows([o(1), o(2)]);
  const merged = mergeTriageRows(prev, [o(9), o(1), o(2)]);
  assert.deepEqual(ids(merged), [1, 2, 9]);
  assert.equal(merged[2].isNew, true);
  const again = mergeTriageRows(merged, [o(1), o(2), o(9)]);
  assert.equal(again[2].isNew, true);
});

test("a gone row that comes back is restored in place; gone label is sticky while gone", () => {
  const prev = replaceTriageRows([o(1), o(2)]);
  const gone = mergeTriageRows(prev, [o(1)], new Map([[2, "SCHEDULED"]]));
  const stillGone = mergeTriageRows(gone, [o(1)]);
  assert.equal(stillGone[1].goneLabel, "→ Scheduled");
  const back = mergeTriageRows(stillGone, [o(1), o(2)]);
  assert.equal(back[1].gone, false);
  assert.equal(back[1].goneLabel, null);
});

test("patchTriageRow updates content without moving the row", () => {
  const rows = patchTriageRow(replaceTriageRows([o(1), o(2)]), 2, { status: "SCHEDULED", version: 5 });
  assert.deepEqual(ids(rows), [1, 2]);
  assert.equal(rows[1].order.status, "SCHEDULED");
  assert.equal(rows[1].order.version, 5);
});

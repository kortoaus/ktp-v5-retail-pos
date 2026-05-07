import assert from "node:assert/strict";
import test from "node:test";

import { randomInitialDocCounter } from "./sale.doc-counter";

test("randomInitialDocCounter requests a starting serial above 100 and below 1000", () => {
  const result = randomInitialDocCounter((min, max) => {
    assert.equal(min, 101);
    assert.equal(max, 1000);
    return 437;
  });

  assert.equal(result, 437);
});

test("randomInitialDocCounter rejects generator values outside the visible serial range", () => {
  assert.throws(
    () => randomInitialDocCounter(() => 100),
    /outside supported range/,
  );
  assert.throws(
    () => randomInitialDocCounter(() => 1000),
    /outside supported range/,
  );
});

import assert from "node:assert/strict";

import {
  RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
  normalizeReceiptExtraFooterPayload,
  receiptFooterPrintWidth,
  splitReceiptExtraFooterLines,
  truncateReceiptExtraFooterLine,
  validateReceiptExtraFooterText,
} from "../../src/renderer/src/libs/receipt-extra-footer.ts";

assert.equal(RECEIPT_EXTRA_FOOTER_LINE_WIDTH, 42);
assert.equal(receiptFooterPrintWidth("ABC 123"), 7);
assert.equal(receiptFooterPrintWidth("한글"), 4);
assert.equal(receiptFooterPrintWidth("A한B"), 4);

assert.deepEqual(splitReceiptExtraFooterLines("Line 1\n\nLine 3"), [
  "Line 1",
  "",
  "Line 3",
]);

assert.deepEqual(splitReceiptExtraFooterLines(""), []);
assert.deepEqual(splitReceiptExtraFooterLines("   \n\t"), []);
assert.equal(normalizeReceiptExtraFooterPayload("   \n\t"), undefined);
assert.equal(
  normalizeReceiptExtraFooterPayload("Line 1\r\nLine 2"),
  "Line 1\nLine 2",
);

const valid = validateReceiptExtraFooterText("A".repeat(42) + "\n한글");
assert.equal(valid.ok, true);
assert.deepEqual(valid.errors, []);

const invalid = validateReceiptExtraFooterText("A".repeat(43) + "\nOK");
assert.equal(invalid.ok, false);
assert.deepEqual(invalid.errors, [
  { lineNumber: 1, width: 43, maxWidth: 42 },
]);

assert.equal(truncateReceiptExtraFooterLine("A".repeat(45)), "A".repeat(42));
assert.equal(truncateReceiptExtraFooterLine("한".repeat(30)), "한".repeat(21));

console.log("receipt-extra-footer tests passed");

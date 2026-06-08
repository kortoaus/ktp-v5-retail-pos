import assert from "node:assert/strict";
import { parseInvoiceSearchScan } from "../../src/renderer/src/libs/invoice-search-scan.ts";

assert.deepEqual(parseInvoiceSearchScan("receipt%%%INV-123"), {
  type: "receipt",
  serial: "INV-123",
});

assert.deepEqual(parseInvoiceSearchScan("member%%%crm-42"), {
  type: "member",
  memberId: "crm-42",
});

assert.deepEqual(parseInvoiceSearchScan("INV-999"), {
  type: "keyword",
  keyword: "INV-999",
});

console.log("invoice-search-scan tests passed");

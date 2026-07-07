import assert from "node:assert/strict";
import test from "node:test";

import { getPriceTag7090CornerText } from "./layout.ts";

test("getPriceTag7090CornerText uses barcode text instead of item code", () => {
  assert.equal(
    getPriceTag7090CornerText({
      code: "ITEM-123",
      barcodeText: "9300000000011",
    }),
    "9300000000011",
  );
});

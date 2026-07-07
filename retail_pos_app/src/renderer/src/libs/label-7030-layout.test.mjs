import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceTag7030ProductRows } from "./label-7030-layout.ts";

test("buildPriceTag7030ProductRows limits names and prints barcode text last", () => {
  const calls = [];
  const splitText = (text, maxChars) => {
    calls.push({ text, maxChars });
    return text === "ko name"
      ? ["ko line 1", "ko line 2"]
      : ["en line 1", "en line 2", "en line 3"];
  };

  const rows = buildPriceTag7030ProductRows({
    nameKo: "ko name",
    nameEn: "en name",
    barcodeText: "9300000000011",
    splitText,
  });

  assert.deepEqual(calls, [
    { text: "ko name", maxChars: 18 },
    { text: "en name", maxChars: 30 },
  ]);
  assert.deepEqual(
    rows.map(({ kind, text }) => ({ kind, text })),
    [
      { kind: "ko", text: "ko line 1" },
      { kind: "en", text: "en line 1" },
      { kind: "en", text: "en line 2" },
      { kind: "barcode", text: "9300000000011" },
    ],
  );
});

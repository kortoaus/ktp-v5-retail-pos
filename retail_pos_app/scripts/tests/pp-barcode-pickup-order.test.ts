import assert from "node:assert/strict";
import test from "node:test";

const { parsePPBarcode } = await import(
  "../../src/renderer/src/libs/pp-barcode.ts"
);

test("parsePPBarcode reads positive integer pickup order id from field 09", () => {
  const parsed = parsePPBarcode(
    '00:{"00":2,"01":"9330001112223","02":[1299],"03":[],"09":260708869}',
  );

  assert.equal(parsed?.barcode, "9330001112223");
  assert.equal(parsed?.pickupOrderId, 260708869);
});

test("parsePPBarcode treats missing or invalid pickup order id as null", () => {
  const cases = [
    '00:{"01":"9330001112223","02":[],"03":[]}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":0}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":-1}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":1.2}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":"260708869"}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":null}',
  ];

  for (const raw of cases) {
    assert.equal(parsePPBarcode(raw)?.pickupOrderId, null, raw);
  }
});

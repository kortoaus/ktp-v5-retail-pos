// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import {
  PP_VERSION,
  buildPPBarcodeString,
  calcMarkdownPrice,
  isPPBarcode,
  parsePPBarcode,
} from "./pp-barcode.ts";

const FULL = {
  barcode: "9300001",
  prices: [6200, 6200, 6200, 6200, 6200],
  promoPrices: [5500, 5500, 5500, 5500, 5500],
  weight: 512,
  discountType: "pct",
  discountAmount: 200,
  packedOn: "2026-08-26",
  usedBy: 1,
};

test("the builder always stamps a version", () => {
  const raw = buildPPBarcodeString({
    barcode: "9300001",
    prices: [6200],
    promoPrices: [],
  });
  assert.ok(raw.startsWith('00:{"00":2,'), raw);
  assert.equal(parsePPBarcode(raw).version, PP_VERSION);
});

test("00 / 07 / 08 survive a build-parse round trip", () => {
  const raw = buildPPBarcodeString(FULL);
  assert.ok(isPPBarcode(raw));

  const parsed = parsePPBarcode(raw);
  assert.equal(parsed.version, PP_VERSION);
  assert.equal(parsed.packedOn, "2026-08-26");
  assert.equal(parsed.usedBy, 1);
  assert.equal(parsed.barcode, "9300001");
  assert.deepEqual(parsed.prices, FULL.prices);
  assert.deepEqual(parsed.promoPrices, FULL.promoPrices);
  assert.equal(parsed.weight, 512);
  assert.equal(parsed.discountType, "pct");
  assert.equal(parsed.discountAmount, 200);
});

test("the new fields are optional in both directions", () => {
  const raw = buildPPBarcodeString({ ...FULL, packedOn: null, usedBy: null });
  assert.ok(!raw.includes('"07"') && !raw.includes('"08"'), raw);

  const parsed = parsePPBarcode(raw);
  assert.equal(parsed.packedOn, undefined);
  assert.equal(parsed.usedBy, undefined);
  assert.equal(parsed.usedBy ?? 0, 0, "an absent use-by is absent, not zero");

  // A day-zero use-by is a real value and has to survive.
  assert.equal(parsePPBarcode(buildPPBarcodeString({ ...FULL, usedBy: 0 })).usedBy, 0);
});

test("a payload printed before 00/07/08 existed still parses", () => {
  const legacy = '00:{"01":"9300001","02":[6200],"03":[5500],"04":512}';
  const parsed = parsePPBarcode(legacy);

  assert.equal(parsed.barcode, "9300001");
  assert.equal(parsed.weight, 512);
  assert.equal(parsed.version, undefined);
  assert.equal(parsed.packedOn, undefined);
});

test("unknown keys are still ignored", () => {
  const parsed = parsePPBarcode('00:{"01":"9300001","99":"who knows","07":"2026-08-26"}');
  assert.equal(parsed.barcode, "9300001");
  assert.equal(parsed.packedOn, "2026-08-26");
  assert.equal(parsed["99"], undefined);
});

test("not a PP payload, not our problem", () => {
  assert.equal(isPPBarcode("9300001028165"), false);
  assert.equal(parsePPBarcode("9300001028165"), null);
  assert.equal(parsePPBarcode("00:not json"), null);
});

test("markdown clamps at zero and rounds the percentage", () => {
  assert.equal(calcMarkdownPrice(6200, "pct", 200), 4960);
  assert.equal(calcMarkdownPrice(6200, "amt", 700), 5500);
  assert.equal(calcMarkdownPrice(600, "amt", 900), 0);
  assert.equal(calcMarkdownPrice(6200, "pct", 1000), 0);
  assert.equal(calcMarkdownPrice(333, "pct", 333), 222);
});

// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildScaleLabel6040 } from "./scale-6040.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

/** The values on the mockup the owner signed off, so the ZPL is comparable to it. */
const SAMPLE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  packedOnText: "26/08/26",
  usedByText: "27/08/26",
  weightText: "0.512",
  unit: "kg",
  unitPriceText: "$55.00",
  wasUnitPriceText: "$62.00",
  totalText: "$28.16",
  storeName: "DREAM MARKET",
  storeAddress: "42-50 Rowe St. Eastwood NSW 2122",
};

const ONE_D = { ...SAMPLE, barcode: { kind: "ean13", data12: "200000102816" } };
const TWO_D = {
  ...SAMPLE,
  barcode: {
    kind: "pp",
    qrData: '00:{"00":2,"01":"9300001","04":512,"07":"2026-08-26","08":1}',
  },
};

test("1D reproduces the confirmed mockup, field for field", () => {
  const zpl = renderLabel(buildScaleLabel6040(ONE_D));

  for (const line of [
    "^PW480",
    "^LL320",
    "^FO10,12^A@N,30,27,E:NOTOKRB.TTF^FB460,1,0,L,0^FH^FD모듬사시미 (테스트) Assorted Sashimi^FS",
    "^FO10,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDPacked^FS",
    "^FO10,72^A@N,22,20,E:NOTOKRM.TTF^FH^FD26/08/26^FS",
    "^FO120,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDUse by^FS",
    "^FO120,72^A@N,22,20,E:NOTOKRM.TTF^FH^FD27/08/26^FS",
    "^FO230,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDWeight^FS",
    "^FO230,72^A@N,26,23,E:NOTOKRB.TTF^FH^FD0.512 kg^FS",
    "^FO340,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDwas $/kg^FS",
    "^FO340,72^A@N,24,22,E:NOTOKRM.TTF^FH^FD$62.00^FS",
    "^FO10,110^BY2,3,60^BEN,60,Y,N^FH^FD200000102816^FS",
    "^FO240,100^A@N,20,18,E:NOTOKRM.TTF^FH^FD$/kg^FS",
    "^FO240,122^A@N,40,36,E:NOTOKRB.TTF^FH^FD$55.00^FS",
    "^FO340,100^A@N,20,18,E:NOTOKRM.TTF^FH^FDTOTAL^FS",
    "^FO0,232^A@N,34,31,E:NOTOKRBK.TTF^FB480,1,0,C,0^FH^FDDREAM MARKET^FS",
    "^FO0,272^A@N,20,18,E:NOTOKRM.TTF^FB480,1,0,C,0^FH^FD42-50 Rowe St. Eastwood NSW 2122^FS",
  ]) {
    assert.ok(zpl.includes(line), `missing: ${line}`);
  }

  // The total is the one field that gained a block width the mockup did not
  // have: at 48 dots a five-digit total runs off the right edge, so it clips at
  // the label rather than over the margin.
  assert.ok(zpl.includes("^FO340,118^A@N,48,43,E:NOTOKRBK.TTF^FB140,1,0,L,0^FH^FD$28.16^FS"));
});

test("the was-price rule is measured, not guessed", () => {
  const zpl = renderLabel(buildScaleLabel6040(ONE_D));
  // 2 dots left of the price, half a cell down, as wide as the text measures.
  assert.ok(zpl.includes("^FO338,84^GB83,2,2^FS"), zpl);
});

test("2D swaps the EAN for a PP QR and shifts the information row right", () => {
  const zpl = renderLabel(buildScaleLabel6040(TWO_D));

  assert.ok(!zpl.includes("^BEN"), "no linear barcode on the 2D variant");
  assert.ok(zpl.includes(`^FO14,48^BQN,2,3,M^FH^FDMA,${TWO_D.barcode.qrData}^FS`), zpl);
  assert.ok(zpl.includes("^FO130,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDPacked^FS"));
  assert.ok(zpl.includes("^FO240,48^A@N,22,20,E:NOTOKRM.TTF^FH^FDUse by^FS"));
  assert.ok(zpl.includes("^FO350,72^A@N,26,23,E:NOTOKRB.TTF^FH^FD0.512 kg^FS"));
  assert.ok(zpl.includes("^FO130,126^A@N,24,22,E:NOTOKRM.TTF^FH^FD$62.00^FS"));
  assert.ok(zpl.includes("^FO128,138^GB83,2,2^FS"));
  assert.ok(zpl.includes("^FO350,118^A@N,48,43,E:NOTOKRBK.TTF^FB130,1,0,L,0^FH^FD$28.16^FS"));
});

test("nothing lands outside 480 × 320, on either variant", () => {
  const [pageW, pageH] = MEDIA["6040"].dots;
  for (const input of [ONE_D, TWO_D]) {
    for (const el of buildScaleLabel6040(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("the footer and the was-price are optional", () => {
  const bare = buildScaleLabel6040({
    ...ONE_D,
    wasUnitPriceText: null,
    storeName: null,
    storeAddress: null,
  });
  const zpl = renderLabel(bare);

  assert.ok(!zpl.includes("DREAM MARKET"));
  assert.ok(!zpl.includes("was $/kg"));
  assert.ok(!zpl.includes("^GB"), "no strike without a was-price");
  assert.ok(zpl.includes("$28.16"), "the total still prints");
});

test("dbg rides through to the emitter", () => {
  assert.equal(buildScaleLabel6040(ONE_D).dbg, false);
  assert.equal(buildScaleLabel6040(ONE_D, { dbg: true }).dbg, true);
  assert.ok(renderLabel(buildScaleLabel6040(ONE_D, { copies: 3 })).includes("^PQ3"));
});

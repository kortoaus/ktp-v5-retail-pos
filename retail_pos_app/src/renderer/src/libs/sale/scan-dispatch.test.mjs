// npm run test:sale-core (retail-runner T-1) — scan dispatch, incl. F-2.
import assert from "node:assert/strict";
import test from "node:test";

import {
  itemLookupAction,
  lineFromItem,
  lineFromPP,
  memberChangeBlockedMessage,
  memberLookupAction,
  ppLookupAction,
  routeScan,
  searchPickBarcode,
  weighedLine,
} from "./scan-dispatch.ts";
import {
  buildPPBarcodeString,
  isEmbeddedPriceBarcode,
  parseEmbeddedPriceCents,
  parsePPBarcode,
} from "../pp-barcode.ts";
// libs/scan-utils.ts embededPriceParser, restated: that module imports
// service/item.service (axios) at runtime, so node cannot load it here.
const embededPriceParser = (raw13) => parseInt(raw13.slice(7, 12)) / 100;

function item(over = {}) {
  return {
    id: 7,
    name_en: "Beef Mince",
    name_ko: "소고기",
    name_invoice: "",
    brand: null,
    taxable: false,
    isPointExcluded: false,
    uom: "EA",
    barcode: "1234567",
    barcodeGTIN: "9300000123456",
    barcodePLU: "",
    isScale: false,
    scaleData: null,
    price: { id: 1, prices: [1299, 1199] },
    promoPrice: null,
    ...over,
  };
}
const fixedWeight = (over = {}) =>
  item({ isScale: true, scaleData: { isFixedWeight: true }, ...over });
const openWeight = (over = {}) =>
  item({ isScale: true, scaleData: { isFixedWeight: false }, uom: "KG", ...over });

// ── routeScan ────────────────────────────────────────────────
test("routeScan priority: member → order → PP → item", () => {
  assert.deepEqual(routeScan("member%%%abc%%%2"), {
    kind: "member",
    qr: { memberId: "abc", level: 2 },
  });
  assert.deepEqual(routeScan("order%%%42"), { kind: "order", orderId: 42 });
  const pp = buildPPBarcodeString({ barcode: "1234567", prices: [500], promoPrices: [] });
  assert.equal(routeScan(pp).kind, "pp");
  assert.deepEqual(routeScan("00:{broken"), {
    kind: "pp-invalid",
    message: "Invalid prepacked barcode",
  });
  assert.deepEqual(routeScan("9300000123456"), { kind: "item", barcode: "9300000123456" });
});

// ── F-2 guard ────────────────────────────────────────────────
test("F-2: prepacked item scanned by a plain 13-digit GTIN keeps its catalog price", () => {
  const action = lineFromItem(fixedWeight(), "9300000123456");
  assert.equal(action.kind, "add-line");
  assert.equal(action.options, undefined, "no adjustedPrice / qty override");
  assert.deepEqual(action.line.price.prices, [1299, 1199]);
  assert.equal(action.line.type, "prepacked");
});

test("F-2: a GTIN whose digits 8-12 would read as a price is still not a price carrier", () => {
  // digits 8-12 = "01234" → the unguarded code charged $12.34
  const action = lineFromItem(fixedWeight(), "9300000012345");
  assert.equal(action.kind, "add-line");
  assert.equal(action.options, undefined);
  assert.equal(action.line.price.prices[0], 1299);
});

test("prepacked item scanned by a price-embedded EAN-13 takes the embedded price", () => {
  const action = lineFromItem(fixedWeight(), "2123456012340");
  assert.equal(action.kind, "add-line");
  assert.deepEqual(action.options, { qty: 1000, adjustedPrice: 1234 });
  assert.deepEqual(action.line.price.prices, [1234]);
  assert.equal(action.line.uom, "ea");
});

test("open-weight item by an embedded EAN-13 becomes weight-prepacked at the embedded price", () => {
  const action = lineFromItem(openWeight(), "2123456008995");
  assert.equal(action.kind, "add-line");
  assert.equal(action.line.type, "weight-prepacked");
  assert.deepEqual(action.options, { qty: 1000, adjustedPrice: 899 });
});

test("12-digit UPC-A form is normalised before the price window", () => {
  assert.equal(parseEmbeddedPriceCents("212345012345"), 1234); // → 0212345012345
  assert.equal(parseEmbeddedPriceCents("2123456012340"), 1234);
});

test("embedded-price guard: shape check", () => {
  assert.equal(isEmbeddedPriceBarcode("2123456012340"), true);
  assert.equal(isEmbeddedPriceBarcode("0212345012345"), true);
  assert.equal(isEmbeddedPriceBarcode("9300000123456"), false);
  assert.equal(isEmbeddedPriceBarcode("21234560123"), false, "11 digits");
  assert.equal(isEmbeddedPriceBarcode("212345601234X"), false, "non-digit");
  assert.equal(isEmbeddedPriceBarcode("0212345"), false, "7-digit PLU");
  assert.equal(parseEmbeddedPriceCents("9300000123456"), null);
});

test("embedded cents equal the till's old dollars×MONEY_SCALE result", () => {
  for (const raw of ["2123456012340", "2000001000005", "2999999999990", "0212345067891"]) {
    assert.equal(
      parseEmbeddedPriceCents(raw),
      Math.round(embededPriceParser(raw) * 100),
      raw,
    );
  }
});

// ── other item branches (unchanged) ──────────────────────────
test("open-weight item by its plain barcode requests a weight", () => {
  const action = lineFromItem(openWeight(), "1234567");
  assert.equal(action.kind, "request-weight");
  assert.equal(action.line.uom, "kg");
  const { line, options } = weighedLine(action.line, 0.4567);
  assert.equal(line, action.line);
  assert.deepEqual(options, { qty: 457, measured_weight: 457 });
});

test("02xxxxx PLU of a fixed-weight item adds one each at its own price", () => {
  const action = lineFromItem(fixedWeight({ barcodePLU: "0212345" }), "0212345");
  assert.equal(action.kind, "add-line");
  assert.equal(action.options, undefined);
  assert.equal(action.line.uom, "ea");
  assert.equal(action.line.price.prices[0], 1299);
});

test("normal item adds as-is; priceless item is invalid", () => {
  const ok = lineFromItem(item(), "9300000123456");
  assert.equal(ok.kind, "add-line");
  assert.equal(ok.line.type, "normal");
  assert.equal(ok.line.uom, "ea");
  assert.deepEqual(lineFromItem(item({ price: null }), "1"), {
    kind: "alert",
    message: "Invalid item",
  });
});

test("hotkey / search pick barcode: GTIN, then PLU, then barcode", () => {
  assert.equal(searchPickBarcode({ barcode: "b", barcodeGTIN: "g", barcodePLU: "p" }), "g");
  assert.equal(searchPickBarcode({ barcode: "b", barcodeGTIN: "", barcodePLU: "p" }), "p");
  assert.equal(searchPickBarcode({ barcode: "b", barcodeGTIN: "", barcodePLU: "" }), "b");
});

test("itemLookupAction: error alerts, ok-without-item is silent", () => {
  assert.deepEqual(itemLookupAction({ ok: false, msg: "nope" }, "1"), {
    kind: "alert",
    message: "nope",
  });
  assert.deepEqual(itemLookupAction({ ok: true, msg: "", result: null }, "1"), {
    kind: "none",
  });
  assert.equal(itemLookupAction({ ok: true, msg: "", result: item() }, "1").kind, "add-line");
});

// ── PP ───────────────────────────────────────────────────────
test("PP with weight and pct markdown: label prices, markdown on member price", () => {
  const pp = parsePPBarcode(
    buildPPBarcodeString({
      barcode: "1234567",
      prices: [2000, 1800],
      promoPrices: [],
      weight: 750,
      discountType: "pct",
      discountAmount: 250,
    }),
  );
  const action = lineFromPP(pp, openWeight(), 1);
  assert.equal(action.kind, "add-line");
  assert.equal(action.line.type, "weight-prepacked");
  assert.equal(action.line.name_en, "[25% OFF] Beef Mince");
  assert.deepEqual(action.line.price.prices, [2000, 1800]);
  assert.deepEqual(action.options, {
    qty: 750,
    measured_weight: 750,
    adjustedPrice: 1350,
    ppMarkdown: { discountType: "pct", discountAmount: 250 },
  });
});

test("PP amount markdown without weight; plain PP has no options", () => {
  const amt = parsePPBarcode(
    buildPPBarcodeString({
      barcode: "1234567",
      prices: [1000],
      promoPrices: [900],
      discountType: "amt",
      discountAmount: 150,
    }),
  );
  const now = new Date("2026-10-16T00:00:00.000Z");
  const a = lineFromPP(amt, item(), 0, now);
  assert.equal(a.line.name_en, "[$1.50 OFF] Beef Mince");
  assert.deepEqual(a.line.promoPrice.prices, [900]);
  assert.equal(a.line.promoPrice.validFrom, now.toISOString());
  assert.deepEqual(a.options, {
    adjustedPrice: 750,
    ppMarkdown: { discountType: "amt", discountAmount: 150 },
  });

  const plain = parsePPBarcode(
    buildPPBarcodeString({ barcode: "1234567", prices: [1000], promoPrices: [] }),
  );
  const p = lineFromPP(plain, item(), 0);
  assert.equal(p.options, undefined);
  assert.equal(p.line.promoPrice, null);
});

test("ppLookupAction: missing item alerts 'Item not found' when msg is empty", () => {
  const pp = parsePPBarcode(
    buildPPBarcodeString({ barcode: "1", prices: [1], promoPrices: [] }),
  );
  assert.deepEqual(ppLookupAction({ ok: false, msg: "" }, pp, 0), {
    kind: "alert",
    message: "Item not found",
  });
});

// ── member ───────────────────────────────────────────────────
test("member QR: verified attach, offline unverified attach, error alert", () => {
  const qr = { memberId: "m-1", level: null };
  const online = memberLookupAction(
    {
      ok: true,
      msg: "",
      status: 200,
      result: { id: "m-1", name: "Kim", level: 3, phone_last4: "1234", points: 50, extra: 1 },
    },
    qr,
  );
  assert.deepEqual(online, {
    kind: "set-member",
    member: { id: "m-1", name: "Kim", level: 3, phone_last4: "1234", points: 50 },
  });
  const offline = memberLookupAction({ ok: false, msg: "net", status: 0 }, qr);
  assert.deepEqual(offline.member, {
    id: "m-1",
    name: null,
    level: 1,
    phone_last4: null,
    points: null,
    unverified: true,
  });
  assert.deepEqual(memberLookupAction({ ok: false, msg: "Not found", status: 404 }, qr), {
    kind: "alert",
    message: "Not found",
  });
});

test("member change is blocked on an order-loaded cart", () => {
  assert.equal(memberChangeBlockedMessage({ externalOrderId: null, orderNo: null }), null);
  assert.equal(
    memberChangeBlockedMessage({ externalOrderId: "ord-9", orderNo: "A12" }),
    "This cart is linked to order #A12 — clear the cart to change member.",
  );
  assert.match(memberChangeBlockedMessage({ externalOrderId: "ord-9", orderNo: null }), /#ord-9/);
});

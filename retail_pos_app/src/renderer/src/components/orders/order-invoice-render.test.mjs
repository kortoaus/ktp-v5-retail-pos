// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderInvoiceEscposLines,
  buildOrderInvoiceModel,
  cellWidth,
  escposItemRows,
  escposLinesToText,
  escposSafe,
  ESC_LINE,
  formatInvoiceFulfillmentLine,
  formatInvoicePaymentLines,
  itemDescriptionLines,
  orderItemsGst,
  wrapToWidth,
} from "./order-invoice-render.ts";

// 2026-09-24T06:10Z = 4:10pm AEST
const PRINTED = new Date("2026-09-24T06:10:00.000Z");

const SHOP = {
  companyName: "Uncles Butchery Pty Ltd",
  name: "Uncles Butchery",
  phone: "02 8041 9777",
  address1: "49 Rowe Street",
  address2: "",
  suburb: "Eastwood",
  state: "NSW",
  postcode: "2122",
  abn: "26 636 628 389",
  website: "unclesbutchery.com",
  receipt_below_text: "Thank you!",
};

function line(overrides = {}) {
  return {
    id: 21,
    sourceItemId: 56895,
    name_en: "Pork Belly Special Cut 550g/2-3pcs",
    name_ko: "칼집 삼겹살",
    thumb: "",
    qty: 2,
    unitBasePrice: 1699,
    optionsTotal: 0,
    unitPrice: 1699,
    lineTotal: 3398,
    taxable: false,
    deliverySurchargePerUnit: 0,
    isAgeRestricted: false,
    sort: 0,
    pickedQty: null,
    options: [],
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    state: "CAPTURED",
    refundDue: false,
    lastError: null,
    authorizedAmount: 4398,
    capturedAmount: 4398,
    refundedAmount: 0,
    authorizedAt: "2026-09-24T02:11:19.580Z",
    capturedAt: "2026-09-24T22:34:03.931Z", // 25/09 Sydney
    voidedAt: null,
    refunds: [],
    method: { brand: "visa", last4: "4242", wallet: null },
    stripePaymentIntentId: "pi_1",
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 15,
    orderNo: "260924-313",
    fulfillment: "DELIVERY",
    paymentMethod: "STRIPE",
    payment: payment(),
    memberName: "Jane Kim",
    memberPhoneLast3: "035",
    pickupDate: null,
    pickupSlotMinutes: null,
    deliveryEtaDate: "2026-09-25",
    shippingLabel: "Home",
    shippingAddress1: "1 Smoke St",
    shippingAddress2: "",
    shippingSuburb: "Pymble",
    shippingState: "NSW",
    shippingPostcode: "2073",
    shippingNote: "Leave at the door",
    subtotal: 3398,
    surchargeTotal: 0,
    deliveryFee: 1000,
    total: 4398,
    requiresAgeCheck: false,
    posInvoiceSerial: null,
    placedAt: "2026-09-24T05:42:00.000Z", // 3:42pm
    lines: [line()],
    ...overrides,
  };
}

const WINDOW = { startMinutes: 540, endMinutes: 1260 };

test("header: INVOICE + number, shop block, placed/printed in Sydney", () => {
  const m = buildOrderInvoiceModel(order(), SHOP, { printedAt: PRINTED, deliveryWindow: WINDOW });
  assert.equal(m.title, "INVOICE");
  assert.equal(m.invoiceNo, "Invoice #260924-313");
  assert.equal(m.shopName, "Uncles Butchery");
  assert.deepEqual(m.shopLines, ["49 Rowe Street", "Eastwood NSW 2122"]);
  assert.deepEqual(m.shopContact, ["Ph 02 8041 9777", "ABN 26 636 628 389", "unclesbutchery.com"]);
  assert.equal(m.placedLine, "Placed 24/09/2026 3:42pm");
  assert.equal(m.printedLine, "Printed 24/09/2026 4:10pm");
  assert.equal(m.footer, "Thank you!");
});

test("shop name falls back to companyName; missing shop = empty blocks", () => {
  assert.equal(
    buildOrderInvoiceModel(order(), { ...SHOP, name: " " }, { printedAt: PRINTED }).shopName,
    "Uncles Butchery Pty Ltd",
  );
  const bare = buildOrderInvoiceModel(order(), null, { printedAt: PRINTED });
  assert.equal(bare.shopName, "");
  assert.deepEqual(bare.shopLines, []);
  assert.deepEqual(bare.shopContact, []);
  assert.equal(bare.footer, null);
});

test("fulfillment line", () => {
  assert.equal(
    formatInvoiceFulfillmentLine(order(), WINDOW),
    "Home delivery · Fri 25 Sep · 9am–9pm",
  );
  assert.equal(formatInvoiceFulfillmentLine(order(), null), "Home delivery · Fri 25 Sep");
  assert.equal(
    formatInvoiceFulfillmentLine(
      order({ fulfillment: "CLICK_AND_COLLECT", pickupDate: "2026-09-24", pickupSlotMinutes: 840, deliveryEtaDate: null }),
    ),
    "Click & Collect · Thu 24 Sep 14:00",
  );
});

test("ship to: delivery = name, masked phone, address; C&C = customer without address", () => {
  const m = buildOrderInvoiceModel(order(), SHOP, { printedAt: PRINTED });
  assert.equal(m.shipToTitle, "Ship to");
  assert.deepEqual(m.shipToLines, ["Jane Kim", "Ph •••035", "Home", "1 Smoke St", "Pymble NSW 2073"]);
  assert.equal(m.note, "Leave at the door");
  const cc = buildOrderInvoiceModel(
    order({ fulfillment: "CLICK_AND_COLLECT", paymentMethod: "IN_STORE", shippingNote: " ", requiresAgeCheck: true }),
    SHOP,
    { printedAt: PRINTED },
  );
  assert.equal(cc.shipToTitle, "Customer");
  assert.deepEqual(cc.shipToLines, ["Jane Kim", "Ph •••035"]);
  assert.equal(cc.note, null);
  assert.equal(cc.ageCheck, true);
});

test("items: numbered, en→ko→#id, options indented, money formatted", () => {
  const m = buildOrderInvoiceModel(
    order({
      lines: [
        line(),
        line({
          id: 22,
          name_en: " ",
          qty: 1,
          unitPrice: 2500,
          lineTotal: 2500,
          isAgeRestricted: true,
          options: [
            { sourceOptionGroupId: 1, sourceOptionItemId: 9, groupName_en: "Cut", groupName_ko: "", optionName_en: "Thick", optionName_ko: "", priceDelta: 0, qty: 1 },
            { sourceOptionGroupId: 2, sourceOptionItemId: 8, groupName_en: "", groupName_ko: "", optionName_en: "Soy marinade", optionName_ko: "", priceDelta: 100, qty: 2 },
          ],
        }),
        line({ id: 23, name_en: "", name_ko: "", sourceItemId: 777 }),
      ],
    }),
    SHOP,
    { printedAt: PRINTED },
  );
  assert.deepEqual(
    m.items.map((i) => [i.no, i.description, i.qty, i.unit, i.total]),
    [
      [1, "Pork Belly Special Cut 550g/2-3pcs", "2", "$16.99", "$33.98"],
      [2, "칼집 삼겹살", "1", "$25.00", "$25.00"],
      [3, "#777", "2", "$16.99", "$33.98"],
    ],
  );
  assert.deepEqual(m.items[1].options, ["Cut: Thick", "Soy marinade x2"]);
  assert.equal(m.items[1].ageRestricted, true);
});

test("totals: delivery fee (Free when 0), surcharge only >0, total strong", () => {
  const m = buildOrderInvoiceModel(order(), SHOP, { printedAt: PRINTED });
  assert.deepEqual(m.totals, [
    { label: "Subtotal", value: "$33.98" },
    { label: "Delivery fee", value: "$10.00" },
    { label: "Total", value: "$43.98", strong: true },
  ]);
  const withSurcharge = buildOrderInvoiceModel(
    order({ deliveryFee: 0, surchargeTotal: 500, total: 3898 }),
    SHOP,
    { printedAt: PRINTED },
  );
  assert.deepEqual(withSurcharge.totals.map((t) => [t.label, t.value]), [
    ["Subtotal", "$33.98"],
    ["Delivery fee", "Free"],
    ["Heavy-item surcharge", "$5.00"],
    ["Total", "$38.98"],
  ]);
  const cc = buildOrderInvoiceModel(order({ fulfillment: "CLICK_AND_COLLECT", deliveryFee: 0 }), SHOP, { printedAt: PRINTED });
  assert.deepEqual(cc.totals.map((t) => t.label), ["Subtotal", "Total"]);
});

test("GST: sale-invoice rule round(lineTotal/11) on taxable line snapshots only; omitted at 0", () => {
  assert.equal(orderItemsGst([line({ taxable: true, lineTotal: 1100 }), line({ taxable: true, lineTotal: 1699 }), line()]), 100 + 154);
  assert.equal(buildOrderInvoiceModel(order(), SHOP, { printedAt: PRINTED }).gstLine, null);
  assert.deepEqual(
    buildOrderInvoiceModel(order({ lines: [line({ taxable: true, lineTotal: 1100 })] }), SHOP, { printedAt: PRINTED }).gstLine,
    { label: "GST incl. (items)", value: "$1.00" },
  );
});

test("payment lines", () => {
  assert.deepEqual(formatInvoicePaymentLines(order()), ["Paid by Visa •••• 4242", "Charged 25/09/2026"]);
  assert.deepEqual(
    formatInvoicePaymentLines(order({ payment: payment({ method: { brand: "visa", last4: "4242", wallet: "apple_pay" } }) })),
    ["Paid by Apple Pay (Visa •••• 4242)", "Charged 25/09/2026"],
  );
  assert.deepEqual(
    formatInvoicePaymentLines(order({ payment: payment({ state: "AUTHORIZED", capturedAt: null }) })),
    ["Card on hold (Visa •••• 4242)"],
  );
  assert.deepEqual(
    formatInvoicePaymentLines(order({ payment: payment({ state: "PARTIALLY_REFUNDED", refundedAmount: 300 }) })),
    ["Paid by Visa •••• 4242", "Charged 25/09/2026", "Refunded $3.00"],
  );
  assert.deepEqual(
    formatInvoicePaymentLines(order({ payment: payment({ state: "VOIDED", capturedAt: null, method: null }) })),
    ["Card hold released - not charged"],
  );
  assert.deepEqual(formatInvoicePaymentLines(order({ paymentMethod: "IN_STORE" })), ["Pay in store"]);
  assert.deepEqual(
    formatInvoicePaymentLines(order({ paymentMethod: "IN_STORE", posInvoiceSerial: "T1-0042" })),
    ["Paid in store (T1-0042)"],
  );
});

test("wrapToWidth: word wrap, hard-splits long words, measure-agnostic", () => {
  assert.deepEqual(wrapToWidth("Pork Belly Special Cut 550g/2-3pcs", 18), ["Pork Belly Special", "Cut 550g/2-3pcs"]);
  assert.deepEqual(wrapToWidth("ABCDEFGHIJ", 4), ["ABCD", "EFGH", "IJ"]);
  assert.deepEqual(wrapToWidth("  ", 10), [""]);
  // 캔버스 모드: px 측정 함수 (글자당 10px)
  assert.deepEqual(wrapToWidth("aa bb cc", 50, (s) => s.length * 10), ["aa bb", "cc"]);
  assert.equal(cellWidth("김a"), 3);
});

test("itemDescriptionLines: name + [18+], options indented", () => {
  const lines = itemDescriptionLines(
    { no: 1, description: "Soju Classic", options: ["Chilled"], ageRestricted: true, qty: "1", unit: "$5.00", total: "$5.00" },
    18,
  );
  assert.deepEqual(lines, [
    { text: "Soju Classic [18+]", option: false },
    { text: "  + Chilled", option: true },
  ]);
});

test("escpos rows: 42 columns, numbers on first row only", () => {
  const rows = escposItemRows({
    no: 1,
    description: "Pork Belly Special Cut 550g/2-3pcs",
    options: [],
    ageRestricted: false,
    qty: "2",
    unit: "$16.99",
    total: "$33.98",
  });
  assert.deepEqual(rows, [
    "1. Pork Belly Special   2  $16.99   $33.98",
    "   Cut 550g/2-3pcs",
  ]);
  assert.equal(cellWidth(rows[0]), ESC_LINE);
});

test("escpos layout: sections in order, ASCII-safe, every line ≤ 42", () => {
  const m = buildOrderInvoiceModel(order({ requiresAgeCheck: true }), SHOP, { printedAt: PRINTED, deliveryWindow: WINDOW });
  const lines = buildOrderInvoiceEscposLines(m);
  for (const l of lines) assert.ok(cellWidth(l.text) <= ESC_LINE, l.text);
  const text = escposLinesToText(lines);
  const order_ = ["INVOICE", "Invoice #260924-313", "ABN 26 636 628 389", "Placed 24/09/2026 3:42pm", "Home delivery - Fri 25 Sep - 9am-9pm", "Ship to", "| Note: Leave at the door", "ID CHECK 18+", "No Description", "End of items", "Delivery fee", "Payment", "Paid by Visa **** 4242", "Thank you!"];
  let at = -1;
  for (const needle of order_) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${needle} after previous`);
    at = next;
  }
  assert.equal(escposSafe("a • b · c – d"), "a * b - c - d");
  const total = lines.find((l) => l.text.startsWith("Total"));
  assert.equal(total.bold, true);
  assert.equal(total.tall, true);
  assert.equal(lines.find((l) => l.text.includes("ID CHECK")).invert, true);
});

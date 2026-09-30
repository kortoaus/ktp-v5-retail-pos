// node --experimental-strip-types src/renderer/src/components/orders/pick-list-render.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPackingSlipModel,
  buildPickListRenderModel,
  buildPickSummaryModel,
  formatAddressLines,
  formatOrderDueDisplay,
  formatOrderFulfillmentLabel,
} from "./pick-list-render.ts";

// 2026-09-24T05:42Z = 3:42pm AEST
const PRINTED = new Date("2026-09-24T05:42:00.000Z");

function makeLine(overrides = {}) {
  return {
    id: 11,
    sourceItemId: 501,
    name_en: "Seaweed Rice Roll",
    name_ko: "김밥",
    thumb: "",
    qty: 2,
    unitBasePrice: 500,
    optionsTotal: 0,
    unitPrice: 500,
    lineTotal: 1000,
    taxable: true,
    deliverySurchargePerUnit: 0,
    isAgeRestricted: false,
    sort: 0,
    options: [],
    ...overrides,
  };
}

function makeDetail(overrides = {}) {
  return {
    id: 42,
    orderNo: "CC-260813-004",
    fulfillment: "CLICK_AND_COLLECT",
    status: "ACCEPTED",
    paymentMethod: "IN_STORE",
    paymentStatus: "UNPAID",
    memberId: "m-1",
    memberName: "Jane Kim",
    memberPhoneLast3: "123",
    pickupDate: "2026-08-14",
    pickupSlotMinutes: 630,
    deliveryEtaDate: null,
    shippingLabel: null,
    shippingAddress1: null,
    shippingAddress2: null,
    shippingSuburb: null,
    shippingState: null,
    shippingPostcode: null,
    shippingNote: null,
    subtotal: 1000,
    surchargeTotal: 0,
    deliveryFee: 0,
    total: 1000,
    requiresAgeCheck: false,
    rejectReason: null,
    posInvoiceSerial: null,
    version: 3,
    placedAt: "2026-08-13T00:00:00.000Z",
    acceptedAt: null,
    readyAt: null,
    collectedAt: null,
    cancelledAt: null,
    rejectedAt: null,
    expiredAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    dueAt: "2026-08-14T00:30:00.000Z",
    lines: [makeLine()],
    events: [],
    ...overrides,
  };
}

test("model maps header fields: orderNo, member+phone3, fulfillment, due", () => {
  const model = buildPickListRenderModel(makeDetail());
  assert.equal(model.orderNo, "CC-260813-004");
  assert.equal(model.memberLine, "Jane Kim (…123)");
  assert.equal(model.fulfillmentLabel, "CLICK & COLLECT");
  // AEST(UTC+10): 2026-08-14T00:30Z → 10:30 local
  assert.equal(model.dueDisplay, "Fri, 14 Aug 2026 10:30");
});

test("qr content follows the order%%%<orderId> convention", () => {
  const model = buildPickListRenderModel(makeDetail({ id: 987 }));
  assert.equal(model.qrContent, "order%%%987");
});

test("all lines become checklist rows; made-to-order marked via options", () => {
  const detail = makeDetail({
    lines: [
      makeLine({ id: 1, name_en: "Plain Item", qty: 3, options: [] }),
      makeLine({
        id: 2,
        name_en: "Custom Cake",
        qty: 1,
        options: [
          {
            sourceOptionGroupId: 1,
            sourceOptionItemId: 2,
            groupName_en: "Size",
            groupName_ko: "크기",
            optionName_en: "Large",
            optionName_ko: "대",
            priceDelta: 500,
            qty: 1,
          },
        ],
      }),
    ],
  });
  const model = buildPickListRenderModel(detail);
  assert.equal(model.rows.length, 2);
  assert.deepEqual(model.rows[0], {
    name: "Plain Item",
    qty: 3,
    isMadeToOrder: false,
    isAgeRestricted: false,
  });
  assert.deepEqual(model.rows[1], {
    name: "Custom Cake",
    qty: 1,
    isMadeToOrder: true,
    isAgeRestricted: false,
  });
  assert.equal(model.lineCountSummary, "Total 2 lines");
});

test("row name falls back en -> ko -> #sourceItemId", () => {
  const detail = makeDetail({
    lines: [
      makeLine({ id: 1, name_en: "  ", name_ko: "김밥" }),
      makeLine({ id: 2, name_en: "", name_ko: " ", sourceItemId: 77 }),
    ],
  });
  const model = buildPickListRenderModel(detail);
  assert.equal(model.rows[0].name, "김밥");
  assert.equal(model.rows[1].name, "#77");
});

test("singular line count and missing due", () => {
  const model = buildPickListRenderModel(makeDetail({ dueAt: null }));
  assert.equal(model.lineCountSummary, "Total 1 line");
  assert.equal(model.dueDisplay, "—");
});

test("formatOrderFulfillmentLabel covers delivery", () => {
  assert.equal(formatOrderFulfillmentLabel("DELIVERY"), "DELIVERY");
});

test("formatOrderDueDisplay handles null", () => {
  assert.equal(formatOrderDueDisplay(null), "—");
});

test("header line: Order i of n · Printed <Sydney time>, single print = 1 of 1", () => {
  const single = buildPickListRenderModel(makeDetail(), { printedAt: PRINTED });
  assert.equal(single.headerLine, "Order 1 of 1 · Printed 24/09/2026 3:42pm");
  assert.equal(single.title, "PICK LIST");
  const third = buildPickListRenderModel(makeDetail(), { printedAt: PRINTED, index: 3, count: 9 });
  assert.equal(third.headerLine, "Order 3 of 9 · Printed 24/09/2026 3:42pm");
});

test("C&C slip has no address but carries the age check and 18+ line marks", () => {
  const model = buildPickListRenderModel(
    makeDetail({
      requiresAgeCheck: true,
      shippingAddress1: "should not print",
      lines: [makeLine({ isAgeRestricted: true })],
    }),
    { printedAt: PRINTED },
  );
  assert.deepEqual(model.addressLines, []);
  assert.equal(model.deliveryNote, null);
  assert.equal(model.ageCheck, true);
  assert.equal(model.rows[0].isAgeRestricted, true);
});

test("DELIVERY slip: packing slip title, 3 address lines, note, date-only due (no 00:00)", () => {
  const model = buildPickListRenderModel(
    makeDetail({
      fulfillment: "DELIVERY",
      pickupDate: null,
      pickupSlotMinutes: null,
      deliveryEtaDate: "2026-09-26",
      dueAt: "2026-09-25T14:00:00.000Z",
      shippingLabel: "Home",
      shippingAddress1: "12 Smith St",
      shippingAddress2: " ",
      shippingSuburb: "Strathfield",
      shippingState: "NSW",
      shippingPostcode: "2135",
      shippingNote: " Leave at door ",
    }),
    { printedAt: PRINTED },
  );
  assert.equal(model.title, "PACKING SLIP");
  assert.deepEqual(model.addressLines, ["Home", "12 Smith St", "Strathfield NSW 2135"]);
  assert.equal(model.deliveryNote, "Leave at door");
  assert.equal(model.dueDisplay, "Delivery Sat 26 Sep");
});

test("formatAddressLines drops empty parts", () => {
  assert.deepEqual(
    formatAddressLines({
      shippingLabel: null,
      shippingAddress1: "1 A St",
      shippingAddress2: null,
      shippingSuburb: "Ryde",
      shippingState: null,
      shippingPostcode: "2112",
    }),
    ["1 A St", "Ryde 2112"],
  );
});

const MANIFEST_ORDER = {
  id: 77,
  orderNo: "260924-100",
  status: "SCHEDULED",
  version: 4,
  memberName: "Lee",
  memberPhoneLast3: "321",
  shippingLabel: null,
  shippingAddress1: "5 King St",
  shippingAddress2: "Unit 2",
  shippingSuburb: "Burwood",
  shippingState: "NSW",
  shippingPostcode: "2134",
  shippingNote: null,
  requiresAgeCheck: false,
  total: 4200,
  lines: [
    { id: 1, sourceItemId: 9, nameEn: "Beef Brisket", nameKo: "", qty: 2, isAgeRestricted: false, options: [] },
  ],
};

test("packing slip from manifest: shared batch time, position, eta from the list row", () => {
  const model = buildPackingSlipModel(MANIFEST_ORDER, "2026-09-25", { printedAt: PRINTED, index: 2, count: 5 });
  assert.equal(model.headerLine, "Order 2 of 5 · Printed 24/09/2026 3:42pm");
  assert.equal(model.dueDisplay, "Delivery Fri 25 Sep");
  assert.deepEqual(model.addressLines, ["5 King St", "Unit 2", "Burwood NSW 2134"]);
  assert.equal(model.qrContent, "order%%%77");
  assert.equal(model.rows[0].name, "Beef Brisket");
});

test("pick summary: order count header + day + totals rows", () => {
  const model = buildPickSummaryModel(
    {
      date: "2026-09-25",
      orderCount: 3,
      truncated: false,
      orders: [MANIFEST_ORDER, { ...MANIFEST_ORDER, id: 78 }, { ...MANIFEST_ORDER, id: 79 }],
      totals: [{ sourceItemId: 9, nameEn: "Beef Brisket", nameKo: "", qty: 6, orderCount: 3 }],
    },
    PRINTED,
  );
  assert.equal(model.headerLine, "3 orders · Printed 24/09/2026 3:42pm");
  assert.equal(model.dayLine, "Delivery Fri 25 Sep");
  assert.deepEqual(model.rows, [{ name: "Beef Brisket", qty: 6, orderCount: 3 }]);
});

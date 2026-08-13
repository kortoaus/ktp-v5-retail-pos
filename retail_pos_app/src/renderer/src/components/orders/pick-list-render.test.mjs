// node --experimental-strip-types src/renderer/src/components/orders/pick-list-render.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPickListRenderModel,
  formatOrderDueDisplay,
  formatOrderFulfillmentLabel,
} from "./pick-list-render.ts";

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
  });
  assert.deepEqual(model.rows[1], {
    name: "Custom Cake",
    qty: 1,
    isMadeToOrder: true,
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

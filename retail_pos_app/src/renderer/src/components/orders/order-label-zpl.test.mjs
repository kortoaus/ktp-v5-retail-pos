// node --experimental-strip-types src/renderer/src/components/orders/order-label-zpl.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderLabelZpl,
  formatOrderLabelOptionLine,
  sanitizeZplText,
} from "./order-label-zpl.ts";

const ORDER = {
  orderNo: "CC-260813-004",
  // 호출부(OrderViewer)가 formatOrderDueDisplay(detail.dueAt) 로 생성해 전달.
  dueDisplay: "Fri, 14 Aug 2026 10:30",
};

const LINE = {
  id: 11,
  sourceItemId: 501,
  name_en: "Custom Fruit Cake",
  name_ko: "수제 과일 케이크",
  qty: 3,
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
    {
      sourceOptionGroupId: 3,
      sourceOptionItemId: 9,
      groupName_en: "Topping",
      groupName_ko: "토핑",
      optionName_en: "Choc Flakes",
      optionName_ko: "초코",
      priceDelta: 200,
      qty: 2,
    },
  ],
};

test("label frame: 100x100 @203dpi (812x812) ZPL document", () => {
  const zpl = buildOrderLabelZpl(ORDER, LINE);
  assert.ok(zpl.startsWith("^XA"));
  assert.ok(zpl.endsWith("^XZ"));
  assert.ok(zpl.includes("^PW812"));
  assert.ok(zpl.includes("^LL812"));
});

test("label carries item name (en), option breakdown, QTY, orderNo, due", () => {
  const zpl = buildOrderLabelZpl(ORDER, LINE);
  assert.ok(zpl.includes("Custom Fruit Cake"));
  assert.ok(zpl.includes("Size: Large x1"));
  assert.ok(zpl.includes("Topping: Choc Flakes x2"));
  assert.ok(zpl.includes("QTY 3"));
  assert.ok(zpl.includes("CC-260813-004"));
  assert.ok(zpl.includes("Due Fri, 14 Aug 2026 10:30"));
});

test("two placeholder boxes (GB) labelled ORDER QR / PP QR, no real barcodes", () => {
  const zpl = buildOrderLabelZpl(ORDER, LINE);
  const boxes = zpl.match(/\^GB220,220,3/g) ?? [];
  assert.equal(boxes.length, 2);
  assert.ok(zpl.includes("ORDER QR"));
  assert.ok(zpl.includes("PP QR"));
  // 실 바코드/QR 명령 금지 — 자리만 (스펙: PLACEHOLDER only).
  for (const cmd of ["^BC", "^BE", "^BX", "^BQ", "^B3", "^BY"]) {
    assert.ok(!zpl.includes(cmd), `must not contain ${cmd}`);
  }
});

test("korean text is omitted (existing ZPL text pipeline has no Korean support)", () => {
  const zpl = buildOrderLabelZpl(ORDER, LINE);
  assert.ok(!zpl.includes("수제"));
  assert.ok(!zpl.includes("케이크"));
  assert.ok(!/[^\x00-\x7f]/.test(zpl), "ZPL must be ASCII-only");
});

test("ascii-safe name_ko line is kept", () => {
  const zpl = buildOrderLabelZpl(ORDER, {
    ...LINE,
    name_ko: "House Blend (KO)",
  });
  assert.ok(zpl.includes("House Blend (KO)"));
});

test("sanitizeZplText strips ZPL control chars and non-ascii", () => {
  assert.equal(sanitizeZplText("A^B~C\\D"), "A B C D");
  assert.equal(sanitizeZplText("김밥 Roll"), "Roll");
  assert.equal(sanitizeZplText("  a   b  "), "a b");
});

test("empty name_en falls back to #sourceItemId", () => {
  const zpl = buildOrderLabelZpl(ORDER, { ...LINE, name_en: "  " });
  assert.ok(zpl.includes("#501"));
});

test("missing due ('—' placeholder) renders 'Due -'", () => {
  const zpl = buildOrderLabelZpl({ ...ORDER, dueDisplay: "—" }, LINE);
  assert.ok(zpl.includes("Due -"));
});

test("option overflow collapses into '+N more'", () => {
  const manyOptions = Array.from({ length: 20 }, (_, i) => ({
    sourceOptionGroupId: i,
    sourceOptionItemId: i,
    groupName_en: `Group ${i}`,
    groupName_ko: "",
    optionName_en: `Option ${i}`,
    optionName_ko: "",
    priceDelta: 0,
    qty: 1,
  }));
  const zpl = buildOrderLabelZpl(ORDER, { ...LINE, options: manyOptions });
  assert.ok(/\+\d+ more/.test(zpl));
  // 마지막 옵션은 접혔어야 한다.
  assert.ok(!zpl.includes("Option 19"));
});

test("formatOrderLabelOptionLine omits empty group name", () => {
  assert.equal(
    formatOrderLabelOptionLine({
      groupName_en: "",
      optionName_en: "Extra Shot",
      qty: 2,
    }),
    "Extra Shot x2",
  );
});

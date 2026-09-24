// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDriverSheetEscposLines,
  buildDriverSheetModel,
  DRIVER_SHEET_FOOTER,
  formatAuPhone,
  formatDriverRunTitle,
  formatItemsLine,
  NO_PHONE_TEXT,
  sortStops,
} from "./driver-sheet-render.ts";
import { ESC_LINE, cellWidth, escposLinesToText } from "./order-invoice-render.ts";

// 2026-09-24T06:10Z = 4:10pm AEST
const PRINTED = new Date("2026-09-24T06:10:00.000Z");
const WINDOW = { startMinutes: 540, endMinutes: 1260 };

function stop(overrides = {}) {
  return {
    id: 1,
    orderNo: "260924-1",
    memberName: "Jane Kim",
    contactPhone: "412345678",
    shippingAddress1: "1 George St",
    shippingAddress2: null,
    shippingSuburb: "Sydney",
    shippingState: "NSW",
    shippingPostcode: "2000",
    shippingNote: null,
    requiresAgeCheck: false,
    lines: [{ qty: 2 }, { qty: 1 }],
    ...overrides,
  };
}

test("formatAuPhone: 저장형 9자리·04·+61·61 → 0412 345 678, 유선·기타는 형태 유지, 빈 값 null", () => {
  assert.equal(formatAuPhone("412345678"), "0412 345 678");
  assert.equal(formatAuPhone("0412345678"), "0412 345 678");
  assert.equal(formatAuPhone("+61 412 345 678"), "0412 345 678");
  assert.equal(formatAuPhone("61412345678"), "0412 345 678");
  assert.equal(formatAuPhone("0280419777"), "02 8041 9777");
  assert.equal(formatAuPhone("12345"), "12345");
  assert.equal(formatAuPhone(null), null);
  assert.equal(formatAuPhone("  "), null);
});

test("formatDriverRunTitle: 날짜 + 시간창, 시간창 없으면 날짜만", () => {
  assert.equal(formatDriverRunTitle("2026-09-24", WINDOW), "DRIVER RUN — Thu 24 Sep · 9am–9pm");
  assert.equal(formatDriverRunTitle("2026-09-24", { startMinutes: 540, endMinutes: null }), "DRIVER RUN — Thu 24 Sep");
  assert.equal(formatDriverRunTitle("2026-09-24", null), "DRIVER RUN — Thu 24 Sep");
});

test("sortStops: postcode → suburb → address, 빈 postcode 뒤, 동률은 입력 순서 유지", () => {
  const rows = [
    stop({ id: 1, shippingPostcode: "2100", shippingSuburb: "Brookvale" }),
    stop({ id: 2, shippingPostcode: null }),
    stop({ id: 3, shippingPostcode: "2000", shippingSuburb: "Sydney", shippingAddress1: "9 Pitt St" }),
    stop({ id: 4, shippingPostcode: "2000", shippingSuburb: "Barangaroo" }),
    stop({ id: 5, shippingPostcode: "2000", shippingSuburb: "Sydney", shippingAddress1: "1 George St" }),
    stop({ id: 6, shippingPostcode: "2000", shippingSuburb: "Sydney", shippingAddress1: "1 George St" }),
  ];
  assert.deepEqual(sortStops(rows).map((r) => r.id), [4, 5, 6, 3, 1, 2]);
});

test("formatItemsLine: 수량 합 + 라인 수, 단복수", () => {
  assert.equal(formatItemsLine([{ qty: 2 }, { qty: 1 }]), "3 items · 2 lines");
  assert.equal(formatItemsLine([{ qty: 1 }]), "1 item · 1 line");
  assert.equal(formatItemsLine([]), "0 items · 0 lines");
});

test("buildDriverSheetModel: 머리·정류장 번호·전체 전화·주소·메모·18+·꼬리말", () => {
  const model = buildDriverSheetModel(
    [
      stop({ id: 11, orderNo: "260924-11", shippingPostcode: "2100", shippingSuburb: "Brookvale", requiresAgeCheck: true }),
      stop({
        id: 12,
        orderNo: "260924-12",
        memberName: null,
        contactPhone: null, // 탈퇴·익명화
        shippingAddress2: "Unit 5",
        shippingNote: "Leave at door",
      }),
    ],
    { runDate: "2026-09-24", deliveryWindow: WINDOW, printedAt: PRINTED },
  );
  assert.equal(model.title, "DRIVER RUN — Thu 24 Sep · 9am–9pm");
  assert.equal(model.printedLine, "Printed 24/09/2026 4:10pm · 2 stops");
  assert.equal(model.footer, DRIVER_SHEET_FOOTER);
  assert.deepEqual(model.stops[0], {
    stopNo: 1,
    orderId: 12,
    orderNo: "#260924-12",
    name: "—",
    phone: NO_PHONE_TEXT,
    addressLines: ["1 George St", "Unit 5", "Sydney NSW 2000"],
    note: "Leave at door",
    ageCheck: false,
    itemsLine: "3 items · 2 lines",
  });
  assert.equal(model.stops[1].stopNo, 2);
  assert.equal(model.stops[1].phone, "0412 345 678");
  assert.equal(model.stops[1].ageCheck, true);
  assert.equal(model.stops[1].addressLines.at(-1), "Brookvale NSW 2100");

  const one = buildDriverSheetModel([stop()], { runDate: "2026-09-24", printedAt: PRINTED });
  assert.equal(one.printedLine, "Printed 24/09/2026 4:10pm · 1 stop");
  assert.equal(one.title, "DRIVER RUN — Thu 24 Sep");
});

test("escpos: 42칸 이내 ASCII, 체크박스·ID CHECK·전화·꼬리말", () => {
  const model = buildDriverSheetModel(
    [
      stop({ requiresAgeCheck: true, shippingNote: "Gate code 1234 — ring twice, dog is friendly but loud" }),
      stop({ id: 2, orderNo: "260924-2", shippingPostcode: "2100" }),
    ],
    { runDate: "2026-09-24", deliveryWindow: WINDOW, printedAt: PRINTED },
  );
  const lines = buildDriverSheetEscposLines(model);
  for (const l of lines) {
    assert.ok(cellWidth(l.text) <= ESC_LINE, `too wide: ${l.text}`);
    assert.ok(/^[\x20-\x7e]*$/.test(l.text), `non-ascii: ${l.text}`);
  }
  const text = escposLinesToText(lines);
  assert.match(text, /DRIVER RUN - Thu 24 Sep - 9am-9pm/);
  assert.match(text, /Printed 24\/09\/2026 4:10pm - 2 stops/);
  assert.match(text, /STOP 1\s+#260924-1/);
  assert.match(text, /Ph 0412 345 678/);
  assert.match(text, /\[ ID CHECK 18\+ \]/);
  assert.match(text, /3 items - 2 lines\s+\[ \] Delivered/);
  assert.match(text.replace(/\s+/g, " "), /Keep this sheet private - contains customer contact details\./);
  assert.equal((text.match(/\[ \] Delivered/g) ?? []).length, 2);
});

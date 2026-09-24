// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDriverSheetEscposLines,
  buildDriverSheetModel,
  DRIVER_SHEET_FOOTER,
  formatAuPhone,
  formatDriverDayLabel,
  formatDriverRunTitle,
  formatItemsLine,
  groupStopsByDate,
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
    deliveryDate: "2026-09-24",
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
  assert.equal(formatDriverDayLabel("2026-09-23", WINDOW), "Wed 23 Sep · 9am–9pm");
  assert.equal(formatDriverDayLabel("2026-09-23"), "Wed 23 Sep");
});

test("groupStopsByDate: 배달일 오름차순 묶음, 날짜 안은 postcode 정렬, deliveryDate 없음/빈 값 → runDate", () => {
  const rows = [
    stop({ id: 1, deliveryDate: "2026-09-24", shippingPostcode: "2100" }),
    stop({ id: 2, deliveryDate: "2026-09-23", shippingPostcode: "2200" }),
    stop({ id: 3, deliveryDate: null, shippingPostcode: "2000" }),
    stop({ id: 4, deliveryDate: "2026-09-23", shippingPostcode: "2000" }),
    stop({ id: 5, deliveryDate: undefined, shippingPostcode: "2150" }),
    stop({ id: 6, deliveryDate: "  ", shippingPostcode: "2050" }),
  ];
  assert.deepEqual(
    groupStopsByDate(rows, "2026-09-24").map((g) => [g.date, g.orders.map((o) => o.id)]),
    [
      ["2026-09-23", [4, 2]],
      ["2026-09-24", [3, 6, 1, 5]],
    ],
  );
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
  assert.equal(model.sections.length, 1);
  assert.equal(model.sections[0].header, null); // 한 날짜 = 섹션 머리 없음 (제목과 중복)
  const stops = model.sections[0].stops;
  assert.deepEqual(stops[0], {
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
  assert.equal(stops[1].stopNo, 2);
  assert.equal(stops[1].phone, "0412 345 678");
  assert.equal(stops[1].ageCheck, true);
  assert.equal(stops[1].addressLines.at(-1), "Brookvale NSW 2100");

  const one = buildDriverSheetModel([stop()], { runDate: "2026-09-24", printedAt: PRINTED });
  assert.equal(one.printedLine, "Printed 24/09/2026 4:10pm · 1 stop");
  assert.equal(one.title, "DRIVER RUN — Thu 24 Sep");

  // 한 날짜인데 runDate 와 다르면 제목은 그 배달일 (재인쇄된 과기한 주문만 고른 경우)
  const late = buildDriverSheetModel([stop({ deliveryDate: "2026-09-22" })], { runDate: "2026-09-24", printedAt: PRINTED });
  assert.equal(late.title, "DRIVER RUN — Tue 22 Sep");
});

test("buildDriverSheetModel: 같은 주소 주문 2건 = 정류장 2줄 (합치지 않음)", () => {
  const model = buildDriverSheetModel(
    [stop({ id: 21, orderNo: "260924-21" }), stop({ id: 22, orderNo: "260924-22" })],
    { runDate: "2026-09-24", printedAt: PRINTED },
  );
  const stops = model.sections[0].stops;
  assert.deepEqual(stops.map((s) => [s.stopNo, s.orderId]), [[1, 21], [2, 22]]);
  assert.deepEqual(stops[0].addressLines, stops[1].addressLines);
  assert.equal(model.printedLine, "Printed 24/09/2026 4:10pm · 2 stops");
});

test("buildDriverSheetModel: 배달일 여럿 — 제목 n delivery days, 날짜 섹션 머리, 번호는 섹션마다 1부터", () => {
  const model = buildDriverSheetModel(
    [
      stop({ id: 31, orderNo: "260924-31", shippingPostcode: "2100" }),
      stop({ id: 32, orderNo: "260923-32", deliveryDate: "2026-09-23", shippingPostcode: "2000" }), // 과기한 Out
      stop({ id: 33, orderNo: "260924-33", shippingPostcode: "2000" }),
      stop({ id: 34, orderNo: "260924-34", deliveryDate: null, shippingPostcode: "2050" }), // → runDate
    ],
    { runDate: "2026-09-24", deliveryWindow: WINDOW, printedAt: PRINTED },
  );
  assert.equal(model.title, "DRIVER RUN — 2 delivery days");
  assert.equal(model.printedLine, "Printed 24/09/2026 4:10pm · 4 stops");
  assert.deepEqual(
    model.sections.map((sec) => [sec.date, sec.header, sec.stops.map((s) => [s.stopNo, s.orderId])]),
    [
      ["2026-09-23", "Wed 23 Sep · 9am–9pm", [[1, 32]]],
      ["2026-09-24", "Thu 24 Sep · 9am–9pm", [[1, 33], [2, 34], [3, 31]]],
    ],
  );

  const text = escposLinesToText(buildDriverSheetEscposLines(model));
  assert.match(text, /DRIVER RUN - 2 delivery days/);
  const wed = text.indexOf("Wed 23 Sep - 9am-9pm");
  const thu = text.indexOf("Thu 24 Sep - 9am-9pm");
  assert.ok(wed > 0 && thu > wed, "section headers in date order");
  assert.equal((text.match(/STOP 1\s/g) ?? []).length, 2);
  assert.ok(text.indexOf("#260923-32") > wed && text.indexOf("#260923-32") < thu);
  for (const l of buildDriverSheetEscposLines(model)) assert.ok(cellWidth(l.text) <= ESC_LINE, `too wide: ${l.text}`);
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
  assert.doesNotMatch(text.replace(/DRIVER RUN - Thu 24 Sep - 9am-9pm/, ""), /Thu 24 Sep/); // 한 날짜 = 섹션 머리 없음
  assert.match(text, /Printed 24\/09\/2026 4:10pm - 2 stops/);
  assert.match(text, /STOP 1\s+#260924-1/);
  assert.match(text, /Ph 0412 345 678/);
  assert.match(text, /\[ ID CHECK 18\+ \]/);
  assert.match(text, /3 items - 2 lines\s+\[ \] Delivered/);
  assert.match(text.replace(/\s+/g, " "), /Keep this sheet private - contains customer contact details\./);
  assert.equal((text.match(/\[ \] Delivered/g) ?? []).length, 2);
});

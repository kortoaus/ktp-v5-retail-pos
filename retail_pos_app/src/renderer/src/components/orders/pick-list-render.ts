// 픽업리스트 / packing slip / delivery pick summary 렌더 모델 — 순수 함수,
// 하드웨어/캔버스 무접촉 (슬라이스 C → 2026-09-24 트리아지 스펙 §6.5·A4 확장).
// 캔버스 렌더는 libs/printer/order-pick-list-receipt.ts ·
// libs/printer/delivery-pick-summary-receipt.ts.
//
// - 한 장 = 한 주문 체크리스트(제작 라인 [LABEL] 마커, 18+ 라인 마커). DELIVERY 는
//   주소 3줄·배송메모 (§AB-1), 연령확인 주문은 "ID CHECK 18+" 줄. C&C 는 주소 없음.
// - 머리(A4): "Order 2 of 9 · Printed 24/09/2026 3:42pm" — 같은 배치는 같은 시각
//   (호출측이 배치 시작 시 1회 고정한 Date 를 넘긴다). 단건 인쇄 = "Order 1 of 1".
// - DELIVERY 의 기한은 날짜만("Delivery Thu 26 Sep") — dueAt(ETA 00:00) 표기 금지.
// QR content 는 `order%%%<orderId>`.

import { formatDayLabel, formatPrintedAt } from "./triage-format";
import type {
  DeliveryManifest,
  DeliveryManifestOrder,
  OrderDetail,
  OrderFulfillment,
} from "../../service/order.service";

export type PickListRow = {
  name: string; // en 우선, 비면 ko, 그마저 비면 #<sourceItemId>
  qty: number; // EA 정수 (POS QTY_SCALE 아님)
  isMadeToOrder: boolean; // options.length > 0 — [LABEL] 마커 대상
  isAgeRestricted: boolean; // 18+ 마커
};

export type PickListRenderModel = {
  title: "PICK LIST" | "PACKING SLIP"; // DELIVERY = packing slip
  headerLine: string; // "Order 1 of 3 · Printed 24/09/2026 3:42pm"
  orderNo: string;
  memberLine: string; // "Name (…123)"
  fulfillmentLabel: string;
  dueDisplay: string; // C&C = 슬롯 시각, DELIVERY = "Delivery Thu 26 Sep"
  addressLines: string[]; // DELIVERY 만 (빈 줄 제외)
  deliveryNote: string | null;
  ageCheck: boolean; // "ID CHECK 18+" 줄
  rows: PickListRow[];
  lineCountSummary: string; // "Total N lines"
  qrContent: string; // order%%%<orderId>
};

export type PrintBatchPosition = {
  printedAt: Date; // 배치 시작 시 1회 고정
  index?: number; // 1-based (기본 1)
  count?: number; // 기본 1
};

// 픽업(C&C) 기한 — dueAt 재계산 금지, 서버 ISO 를 시드니로 표시만.
const DUE_FORMAT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatOrderDueDisplay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    DUE_FORMAT.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")} ${part("hour")}:${part("minute")}`;
}

export function formatOrderFulfillmentLabel(fulfillment: OrderFulfillment): string {
  return fulfillment === "CLICK_AND_COLLECT" ? "CLICK & COLLECT" : "DELIVERY";
}

export function formatPrintHeaderLine(position: PrintBatchPosition): string {
  const index = position.index ?? 1;
  const count = position.count ?? 1;
  return `Order ${index} of ${count} · Printed ${formatPrintedAt(position.printedAt)}`;
}

function rowName(name_en: string, name_ko: string, sourceItemId: number): string {
  return name_en.trim() || name_ko.trim() || `#${sourceItemId}`;
}

type AddressInput = {
  shippingLabel: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingSuburb: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
};

// 주소 표시 줄 — label / address1 / address2 / "suburb state postcode" (빈 줄 제외).
export function formatAddressLines(a: AddressInput): string[] {
  const locality = [a.shippingSuburb, a.shippingState, a.shippingPostcode]
    .map((v) => v?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return [a.shippingLabel, a.shippingAddress1, a.shippingAddress2, locality]
    .map((v) => v?.trim() ?? "")
    .filter(Boolean);
}

function lineCountSummary(n: number): string {
  return `Total ${n} line${n === 1 ? "" : "s"}`;
}

function deliveryDue(etaDate: string | null): string {
  return etaDate ? `Delivery ${formatDayLabel(etaDate)}` : "Delivery";
}

export function buildPickListRenderModel(
  detail: OrderDetail,
  position: PrintBatchPosition = { printedAt: new Date() },
): PickListRenderModel {
  const rows: PickListRow[] = detail.lines.map((line) => ({
    name: rowName(line.name_en, line.name_ko, line.sourceItemId),
    qty: line.qty,
    isMadeToOrder: line.options.length > 0,
    isAgeRestricted: line.isAgeRestricted === true,
  }));
  const isDelivery = detail.fulfillment === "DELIVERY";
  const note = detail.shippingNote?.trim() ?? "";

  return {
    title: isDelivery ? "PACKING SLIP" : "PICK LIST",
    headerLine: formatPrintHeaderLine(position),
    orderNo: detail.orderNo,
    memberLine: `${detail.memberName} (…${detail.memberPhoneLast3})`,
    fulfillmentLabel: formatOrderFulfillmentLabel(detail.fulfillment),
    dueDisplay: isDelivery
      ? deliveryDue(detail.deliveryEtaDate)
      : formatOrderDueDisplay(detail.dueAt),
    addressLines: isDelivery ? formatAddressLines(detail) : [],
    deliveryNote: isDelivery && note ? note : null,
    ageCheck: detail.requiresAgeCheck === true,
    rows,
    lineCountSummary: lineCountSummary(rows.length),
    qrContent: `order%%%${detail.id}`,
  };
}

// packing slip — manifest 주문 1건 (DELIVERY 전용). etaDate 는 목록 행에서 넘긴다
// (manifest ids 모드는 주문별 ETA 를 싣지 않는다).
export function buildPackingSlipModel(
  order: DeliveryManifestOrder,
  etaDate: string | null,
  position: PrintBatchPosition,
): PickListRenderModel {
  const rows: PickListRow[] = order.lines.map((line) => ({
    name: rowName(line.nameEn, line.nameKo, line.sourceItemId),
    qty: line.qty,
    isMadeToOrder: line.options.length > 0,
    isAgeRestricted: line.isAgeRestricted === true,
  }));
  const note = order.shippingNote?.trim() ?? "";
  return {
    title: "PACKING SLIP",
    headerLine: formatPrintHeaderLine(position),
    orderNo: order.orderNo,
    memberLine: `${order.memberName} (…${order.memberPhoneLast3})`,
    fulfillmentLabel: formatOrderFulfillmentLabel("DELIVERY"),
    dueDisplay: deliveryDue(etaDate),
    addressLines: formatAddressLines(order),
    deliveryNote: note ? note : null,
    ageCheck: order.requiresAgeCheck === true,
    rows,
    lineCountSummary: lineCountSummary(rows.length),
    qrContent: `order%%%${order.id}`,
  };
}

// --- delivery pick summary (배송일 품목 합계) ---

export type PickSummaryRow = { name: string; qty: number; orderCount: number };

export type PickSummaryRenderModel = {
  headerLine: string; // "9 orders · Printed 24/09/2026 3:42pm"
  dayLine: string; // "Delivery Thu 26 Sep"
  rows: PickSummaryRow[];
  truncated: boolean; // manifest 200건 초과로 잘림
};

export function buildPickSummaryModel(
  manifest: DeliveryManifest,
  printedAt: Date,
): PickSummaryRenderModel {
  const n = manifest.orders.length;
  return {
    headerLine: `${n} order${n === 1 ? "" : "s"} · Printed ${formatPrintedAt(printedAt)}`,
    dayLine: deliveryDue(manifest.date),
    rows: manifest.totals.map((t) => ({
      name: rowName(t.nameEn, t.nameKo, t.sourceItemId),
      qty: t.qty,
      orderCount: t.orderCount,
    })),
    truncated: manifest.truncated === true,
  };
}

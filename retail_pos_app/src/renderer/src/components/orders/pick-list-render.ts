// 픽업리스트(피킹 체크리스트) 렌더 모델 — 순수 함수, 하드웨어/캔버스 무접촉
// (슬라이스 C). 캔버스 렌더는 libs/printer/order-pick-list-receipt.ts.
//
// 전 상품 체크리스트 — 제작(Made to Order) 라인 포함(최종 바구니/어셈블
// 검수용), 제작 라인엔 [LABEL] 마커(라벨 별도). QR content 는
// `order%%%<orderId>` (member%%% 관례 준용 — 스캔 핸들러는 슬라이스 E).

import type {
  OrderDetail,
  OrderFulfillment,
} from "../../service/order.service";

export type PickListRow = {
  name: string; // en 우선, 비면 ko, 그마저 비면 #<sourceItemId>
  qty: number; // EA 정수 (POS QTY_SCALE 아님)
  isMadeToOrder: boolean; // options.length > 0 — [LABEL] 마커 대상
};

export type PickListRenderModel = {
  orderNo: string;
  memberLine: string; // "Name (…123)"
  fulfillmentLabel: string;
  dueDisplay: string; // 서버 계산 dueAt 표시만 — 재계산 금지
  rows: PickListRow[];
  lineCountSummary: string; // "Total N lines"
  qrContent: string; // order%%%<orderId>
};

// dueAt 재계산 금지 — OrderViewerSummary 의 dayjsAU 포맷("ddd, D MMM YYYY
// HH:mm")과 동일 출력. 여기서는 dayjsAU 대신 Intl(Australia/Sydney 고정)로
// 구현 — 이 모듈은 콜로케이트 .test.mjs 로 node 에서 직접 실행되는 순수
// 모듈이라 확장자 없는 런타임 import(dayjs)를 가질 수 없다(기존
// label-7090-v2/layout.ts 관례: 테스트 대상 순수 모듈은 런타임 의존 0).
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

export function formatOrderFulfillmentLabel(
  fulfillment: OrderFulfillment,
): string {
  return fulfillment === "CLICK_AND_COLLECT" ? "CLICK & COLLECT" : "DELIVERY";
}

function rowName(
  name_en: string,
  name_ko: string,
  sourceItemId: number,
): string {
  return name_en.trim() || name_ko.trim() || `#${sourceItemId}`;
}

export function buildPickListRenderModel(
  detail: OrderDetail,
): PickListRenderModel {
  const rows: PickListRow[] = detail.lines.map((line) => ({
    name: rowName(line.name_en, line.name_ko, line.sourceItemId),
    qty: line.qty,
    isMadeToOrder: line.options.length > 0,
  }));

  return {
    orderNo: detail.orderNo,
    memberLine: `${detail.memberName} (…${detail.memberPhoneLast3})`,
    fulfillmentLabel: formatOrderFulfillmentLabel(detail.fulfillment),
    dueDisplay: formatOrderDueDisplay(detail.dueAt),
    rows,
    lineCountSummary: `Total ${rows.length} line${rows.length === 1 ? "" : "s"}`,
    qrContent: `order%%%${detail.id}`,
  };
}

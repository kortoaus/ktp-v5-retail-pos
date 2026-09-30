// 매장 주문 트리아지 화면 — 순수 표시 규칙 (2026-09-24 트리아지 스펙 §6).
// 분류(버킷·이슈)는 crm 이 한다 — 여기서는 crm 이 준 값을 라벨·칩·칼럼 문구로
// 바꾸기만 한다(시간 경과 계산 금지). 날짜는 "YYYY-MM-DD" 문자열에서 직접 뽑고
// (tz 시프트 없음), 인쇄 시각만 Intl(Australia/Sydney) 로 만든다.
// node --test 로 직접 실행되는 순수 모듈 — 런타임 import 0 (type import 만).

import type {
  OrderBuckets,
  OrderFulfillment,
  OrderListPaging,
  OrderPaymentSummary,
  OrderStatus,
  OrderTriage,
  TriageBucket,
  TriageIssueKind,
  TriageListBucket,
} from "../../service/order.service";

export const ORDERS_PATH = "/manager/orders";
// 배너·"Orders: N" 버튼·홈 NavBtn 진입 = New (T1).
export const ORDERS_NEW_PATH = `${ORDERS_PATH}?bucket=new`;

// 트리아지 버킷 목록은 한 번에 로드 (스펙 §6.2).
export const TRIAGE_LIST_LIMIT = 100;

export type TriageLevel1 = "new" | "pickup" | "delivery" | "issues";

// level-2 칩 키: new = all|CLICK_AND_COLLECT|DELIVERY (fulfillment),
// pickup/delivery = 버킷 키, issues = all|IssueKind.
export type TriageView = { level1: TriageLevel1; chip: string };

export const DEFAULT_CHIPS: Record<TriageLevel1, string> = {
  new: "all",
  pickup: "pickup.today",
  delivery: "delivery.today",
  issues: "all",
};

export const ISSUE_KINDS: readonly TriageIssueKind[] = [
  "ACCEPT_OVERDUE",
  "NOT_SCHEDULED",
  "PAYMENT_FAILED",
  "AUTO_VOID_SOON",
  "PICKUP_NOT_READY",
  "NOT_COLLECTED",
  "DELIVERY_LATE",
];

export const ISSUE_KIND_LABELS: Record<TriageIssueKind, string> = {
  ACCEPT_OVERDUE: "Waiting to accept",
  NOT_SCHEDULED: "Not scheduled",
  PAYMENT_FAILED: "Payment failed",
  AUTO_VOID_SOON: "Auto-cancel soon",
  PICKUP_NOT_READY: "Pickup not ready",
  NOT_COLLECTED: "Not collected",
  DELIVERY_LATE: "Delivery late",
};

const PICKUP_BUCKETS: readonly TriageBucket[] = [
  "pickup.today",
  "pickup.ready",
  "pickup.upcoming",
];
const DELIVERY_BUCKETS: readonly TriageBucket[] = [
  "delivery.today",
  "delivery.out",
  "delivery.tomorrow",
  "delivery.upcoming",
];

// ?bucket= 파라미터 → 화면 상태. 없거나 모르는 값 = New (스펙 §6.1 기본 진입).
export function viewFromBucketParam(param: string | null | undefined): TriageView {
  if (param === "issues") return { level1: "issues", chip: "all" };
  if (param && (PICKUP_BUCKETS as readonly string[]).includes(param)) {
    return { level1: "pickup", chip: param };
  }
  if (param && (DELIVERY_BUCKETS as readonly string[]).includes(param)) {
    return { level1: "delivery", chip: param };
  }
  return { level1: "new", chip: "all" };
}

// 현재 화면의 list bucket (paging.bucket 에코 대조용).
export function listBucketOfView(view: TriageView): TriageListBucket {
  if (view.level1 === "new") return "new";
  if (view.level1 === "issues") return "issues";
  return view.chip as TriageBucket;
}

// 목록 쿼리 — bucket + (new 의 fulfillment | issues 의 issue) + page 1, limit 100.
export function listQueryForView(view: TriageView): string {
  const params = new URLSearchParams({ bucket: listBucketOfView(view) });
  if (view.level1 === "new" && view.chip !== "all") {
    params.set("fulfillment", view.chip);
  }
  if (view.level1 === "issues" && view.chip !== "all") {
    params.set("issue", view.chip);
  }
  params.set("page", "1");
  params.set("limit", String(TRIAGE_LIST_LIMIT));
  return `?${params}`;
}

// 구 crm 은 bucket 을 조용히 무시한다(F1) — 에코가 없거나 다르면 true.
export function isBucketEchoMissing(
  paging: OrderListPaging | null,
  requested: TriageListBucket,
): boolean {
  return !paging || paging.bucket !== requested;
}

export type Level1Counts = Record<TriageLevel1, number | null>;

// 1단 바 숫자. Pickup·Delivery = 2단 합계(Upcoming 제외). buckets 없음 = null ("—").
export function level1Counts(buckets: OrderBuckets | null): Level1Counts {
  if (!buckets) return { new: null, pickup: null, delivery: null, issues: null };
  const c = buckets.counts;
  return {
    new: c.new.total,
    pickup: c.pickup.today + c.pickup.ready,
    delivery: c.delivery.today + c.delivery.out + c.delivery.tomorrow,
    issues: c.issues.total,
  };
}

// 1단 세그먼트 톤 — New 주황 / Issues 빨강 (0 초과일 때만), 나머지 회색.
export function level1Tone(
  level1: TriageLevel1,
  count: number | null,
): "orange" | "red" | "gray" {
  if (count == null || count <= 0) return "gray";
  if (level1 === "new") return "orange";
  if (level1 === "issues") return "red";
  return "gray";
}

export type TriageChip = { key: string; label: string; count: number | null };

export function nextDeliveryChipLabel(nextDeliveryDate: string | null): string {
  return nextDeliveryDate ? `Next: ${formatDayLabel(nextDeliveryDate)}` : "Next";
}

// 2단 칩. Issues = All + 카운트>0 인 종류(선택 중인 종류는 0 이어도 유지).
export function chipsForLevel1(
  level1: TriageLevel1,
  buckets: OrderBuckets | null,
  selectedChip: string,
): TriageChip[] {
  const c = buckets?.counts ?? null;
  if (level1 === "new") {
    return [
      { key: "all", label: "All", count: c ? c.new.total : null },
      { key: "CLICK_AND_COLLECT", label: "Pickup", count: c ? c.new.pickup : null },
      { key: "DELIVERY", label: "Delivery", count: c ? c.new.delivery : null },
    ];
  }
  if (level1 === "pickup") {
    return [
      { key: "pickup.today", label: "Today", count: c ? c.pickup.today : null },
      { key: "pickup.ready", label: "Ready", count: c ? c.pickup.ready : null },
      { key: "pickup.upcoming", label: "Upcoming", count: c ? c.pickup.upcoming : null },
    ];
  }
  if (level1 === "delivery") {
    return [
      { key: "delivery.today", label: "Today", count: c ? c.delivery.today : null },
      { key: "delivery.out", label: "Out", count: c ? c.delivery.out : null },
      {
        key: "delivery.tomorrow",
        label: nextDeliveryChipLabel(buckets?.nextDeliveryDate ?? null),
        count: c ? c.delivery.tomorrow : null,
      },
      { key: "delivery.upcoming", label: "Upcoming", count: c ? c.delivery.upcoming : null },
    ];
  }
  const chips: TriageChip[] = [
    { key: "all", label: "All", count: c ? c.issues.total : null },
  ];
  for (const kind of ISSUE_KINDS) {
    const count = c ? (c.issues.byKind[kind] ?? 0) : null;
    if ((count != null && count > 0) || kind === selectedChip) {
      chips.push({ key: kind, label: ISSUE_KIND_LABELS[kind], count });
    }
  }
  return chips;
}

// --- 날짜·시각 표시 ---

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDate(dateStr: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

// "2026-09-26" → "26 Sep"
export function formatShortDate(dateStr: string): string {
  const p = parseDate(dateStr);
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : dateStr;
}

// "2026-09-26" → "Thu 26 Sep" (달력일 자체의 요일 — tz 무관)
export function formatDayLabel(dateStr: string): string {
  const p = parseDate(dateStr);
  if (!p) return dateStr;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${p.d} ${MONTHS[p.m - 1]}`;
}

// minute-of-day → "HH:mm"
export function formatSlot(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// minute-of-day → "9am" / "9:30pm" / "12pm"
export function formatClock12(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// 뷰어 Delivery day — "Thu 26 Sep · 9am–9pm" (시간창 한쪽이라도 null 이면 날짜만).
export function formatDeliveryDay(
  etaDate: string | null,
  window: { startMinutes: number | null; endMinutes: number | null } | null,
): string {
  if (!etaDate) return "—";
  const day = formatDayLabel(etaDate);
  if (!window || window.startMinutes == null || window.endMinutes == null) return day;
  return `${day} · ${formatClock12(window.startMinutes)}–${formatClock12(window.endMinutes)}`;
}

type DueInput = {
  fulfillment: OrderFulfillment;
  pickupDate: string | null;
  pickupSlotMinutes: number | null;
  deliveryEtaDate: string | null;
};

// 행 Due 칼럼 — C&C 슬롯 "HH:mm"(오늘 아니면 "D Mon HH:mm") / DLV "Today"·"D Mon".
// DELIVERY 는 절대 00:00 을 쓰지 않는다 (스펙 §6.1).
export function formatDueColumn(order: DueInput, today: string): string {
  if (order.fulfillment === "CLICK_AND_COLLECT") {
    if (order.pickupSlotMinutes == null) return "—";
    const time = formatSlot(order.pickupSlotMinutes);
    if (order.pickupDate && order.pickupDate !== today) {
      return `${formatShortDate(order.pickupDate)} ${time}`;
    }
    return time;
  }
  if (!order.deliveryEtaDate) return "—";
  return order.deliveryEtaDate === today ? "Today" : formatShortDate(order.deliveryEtaDate);
}

const PRINTED_AT_FORMAT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// 인쇄 머리 시각 — 시드니 "24/09/2026 3:42pm" (A4). 배치 시작 시 1회 고정해서 쓴다.
export function formatPrintedAt(date: Date): string {
  const parts = PRINTED_AT_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dayPeriod = part("dayPeriod").toLowerCase().replace(/[^a-z]/g, "");
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}${dayPeriod}`;
}

// --- 금액 ---

// cents → "$1,234.50"
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${rest}`;
}

// --- 행 표시 ---

// 이슈 칩 — 서버 issueText 최대 2개 + "+n".
export function issueChipsForRow(
  triage: OrderTriage | undefined,
  max = 2,
): { shown: string[]; more: number } {
  const texts = triage?.issueText ?? [];
  return { shown: texts.slice(0, max), more: Math.max(0, texts.length - max) };
}

// 행 좌측 색띠 — 이슈 있음 = 빨강, AUTO_VOID_SOON 만 = 앰버 (기존 색 규칙 계승).
// 정보 배지(Refund requested)는 색띠에 영향 없음.
export function rowStripTone(triage: OrderTriage | undefined): "red" | "amber" | null {
  const issues = triage?.issues ?? [];
  if (issues.length === 0) return null;
  return issues.every((kind) => kind === "AUTO_VOID_SOON") ? "amber" : "red";
}

// 정보 배지 "Refund requested" — OPEN 환불 요청 티켓. 구 crm(openRefundRequest 필드 없음)은
// refundDue(= OPEN 티켓 캐시)로 판정. Issues 가 아니다 (결정 B).
export function hasOpenRefundRequest(payment: OrderPaymentSummary): boolean {
  if (payment.openRefundRequest !== undefined) {
    return payment.openRefundRequest != null && payment.openRefundRequest.count > 0;
  }
  return payment.refundDue === true;
}

// "3× Beef brisket +2"
export function lineSummaryText(order: {
  lineCount: number;
  firstLineNameEn: string | null;
  firstLineNameKo: string | null;
}): string {
  const first = order.firstLineNameEn?.trim() || order.firstLineNameKo?.trim() || "—";
  return order.lineCount > 1 ? `${first} +${order.lineCount - 1}` : first;
}

// 버킷을 벗어난 행에 남기는 결과 태그 (스펙 §6.3). status 모르면 다른 단말 조치로 본다.
const GONE_LABELS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: "→ Accepted",
  READY: "→ Ready",
  SCHEDULED: "→ Scheduled",
  DISPATCHED: "→ Dispatched",
  DELIVERED: "Delivered",
  COLLECTED: "Collected",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export function goneLabelForStatus(status: OrderStatus | null | undefined): string {
  return (status && GONE_LABELS[status]) || "Moved by another till";
}

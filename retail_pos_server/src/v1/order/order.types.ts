// Order inbox (slice A) — crm-server /device/order 프록시 wire 타입.
// 정본은 crm-server 의 RetailOrderAdminSummaryDto + dueAt. POS 는 재계산하지
// 않고 그대로 전달한다 (스펙 2026-08-10-pos-order-inbox-design.md).

// 2026-09-24 Uncles 딜리버리+Stripe (crm 스펙 §3.1): SCHEDULED·DISPATCHED·DELIVERED
// 는 DELIVERY 전용, PENDING_PAYMENT·ABANDONED 는 현장 목록 비노출(crm 이 걸러냄 —
// 유니온에는 방어적으로 포함).
export type OrderStatusWire =
  | "PENDING_PAYMENT"
  | "PLACED"
  | "ACCEPTED"
  | "READY"
  | "SCHEDULED"
  | "DISPATCHED"
  | "DELIVERED"
  | "COLLECTED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "ABANDONED";

export type OrderFulfillmentWire = "CLICK_AND_COLLECT" | "DELIVERY";

// 실제 결제 상태 8값 (crm RetailOrderPaymentStatus). 레거시 paymentStatus
// 필드는 로드 차단용 2값 투영(STRIPE → "PAID")이고, 신규 표시는 payment.state.
export type OrderPaymentStateWire =
  | "UNPAID"
  | "PAID"
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "VOIDED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

// 목록형 결제 블록 (device 요약 — 배지용 최소 필드).
export type OrderPaymentSummaryWire = {
  state: OrderPaymentStateWire;
  refundDue: boolean; // = "OPEN 환불 요청 티켓 있음" 캐시 (환불 티켓 스펙 §4.4)
  lastError: string | null; // 캡처 실패 등 현장 표시용 코드 (예: AUTH_EXPIRED)
  // OPEN 환불 요청 티켓 요약 (환불 티켓 스펙 §5.4) — 구 crm 은 필드 없음.
  openRefundRequest?: OrderOpenRefundRequestWire | null;
};

export type OrderOpenRefundRequestWire = { count: number; amount: number }; // amount cents

export type OrderRefundWire = {
  amount: number; // cents
  status: string; // Stripe 원문
  refundedAt: string; // ISO
};

// 상세형 결제 블록 (device 상세).
export type OrderPaymentDetailWire = {
  state: OrderPaymentStateWire;
  authorizedAmount: number | null; // cents
  capturedAmount: number | null; // cents
  refundedAmount: number; // cents
  refundDue: boolean;
  authorizedAt: string | null;
  capturedAt: string | null;
  voidedAt: string | null;
  refunds: OrderRefundWire[];
  // 결제수단 표시 (crm 2026-09-24 후속) — 브랜드·끝 4자리·지갑만. 구 crm 은 필드 없음.
  method?: OrderPaymentMethodWire | null;
  receiptUrl?: string | null;
  stripePaymentIntentId: string | null;
  lastError: string | null;
  openRefundRequest?: OrderOpenRefundRequestWire | null;
  refundable?: number; // cents — 잔여 환불가능액 (crm 계산, 환불 티켓 스펙 §5.1)
};

export type OrderPaymentMethodWire = {
  brand: string | null; // Stripe card.brand 원문
  last4: string | null;
  wallet: "apple_pay" | "google_pay" | null;
};

// STRIPE 4일 자동 보이드 (crm 스펙 §7) — STRIPE ∧ AUTHORIZED ∧ PLACED|ACCEPTED
// 일 때만 autoVoidAt = placedAt+96h, autoVoidSoon = placedAt+72h 경과(앰버).
// 서버 계산 — POS 재계산 금지.
export type OrderAutoVoidWire = {
  autoVoidAt: string | null; // ISO
  autoVoidSoon: boolean;
};

// 일괄 전이 (POST /device/order/schedule·/dispatch) — 건별 결과, 부분 성공 허용.
export type OrderBulkItemInput = { id: number; version: number };
export type OrderBulkItemResultWire =
  | { id: number; ok: true; status: OrderStatusWire; version: number }
  | { id: number; ok: false; code: string; detail?: string };
export type OrderBulkResultWire = { results: OrderBulkItemResultWire[] };

export type OrderSummaryWire = {
  id: number;
  orderNo: string;
  status: OrderStatusWire;
  fulfillment: OrderFulfillmentWire;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID"; // 레거시 투영 — STRIPE 는 항상 "PAID"
  payment: OrderPaymentSummaryWire;
  memberId: string;
  memberName: string;
  memberPhoneLast3: string;
  subtotal: number;
  surchargeTotal: number;
  deliveryFee: number;
  total: number; // cents
  lineCount: number;
  firstLineNameEn: string | null;
  firstLineNameKo: string | null;
  requiresAgeCheck: boolean;
  pickupDate: string | null; // "YYYY-MM-DD"
  pickupSlotMinutes: number | null; // minute-of-day
  deliveryEtaDate: string | null;
  shippingSuburb: string | null;
  shippingPostcode: string | null;
  placedAt: string; // ISO
  version: number;
  // 서버(crm) 계산 마감 시각. 하위호환 표시용 — 과기한 판정은 triage 만 (트리아지 스펙 §3.5).
  dueAt: string | null; // ISO
  triage?: OrderTriageWire; // 구 crm 은 필드 없음
} & OrderAutoVoidWire;

// crm-server paging wire 형 — 로컬 표준({hasPrev,hasNext,currentPage,totalPages})
// 과 다르므로 order.service 에서 변환한다.
export type CrmPagingWire = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// --- 슬라이스 B: GET /device/order/:id 상세 wire ---
// 정본은 crm-server mapRetailOrderAdminDetail(+dueAt) —
// src/internal/retail-order/retail-order.presenter.ts +
// src/api/order/order.presenter.ts. 요약형과 달리 lineCount/firstLineName*
// 은 없고 lines/events 전체가 온다. POS 는 재계산·재구성 없이 통과.

export type OrderLineOptionWire = {
  sourceOptionGroupId: number;
  sourceOptionItemId: number;
  groupName_en: string;
  groupName_ko: string;
  optionName_en: string;
  optionName_ko: string;
  priceDelta: number; // 단위당 cents
  qty: number;
};

export type OrderLineWire = {
  id: number;
  sourceItemId: number;
  name_en: string;
  name_ko: string;
  thumb: string;
  qty: number; // EA 정수 (POS QTY_SCALE 아님)
  unitBasePrice: number; // cents
  optionsTotal: number; // 단위당 cents
  unitPrice: number; // cents
  lineTotal: number; // cents
  taxable: boolean;
  deliverySurchargePerUnit: number; // cents
  isAgeRestricted: boolean;
  sort: number;
  // S2 러너 피킹 확정 수량 (EA 정수). null = 미기록. device/internal DTO 에만
  // 존재 (소비자형은 필드 자체 제외). S3 로드가 READY 에서 이 값을 쓴다.
  pickedQty: number | null;
  options: OrderLineOptionWire[];
};

export type OrderEventWire = {
  type: string;
  actorType: string;
  actorLabel: string;
  note: string;
  createdAt: string; // ISO
};

export type OrderDetailWire = {
  id: number;
  orderNo: string;
  fulfillment: OrderFulfillmentWire;
  status: OrderStatusWire;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID"; // 레거시 투영 — STRIPE 는 항상 "PAID"
  payment: OrderPaymentDetailWire;
  memberId: string;
  memberName: string;
  memberPhoneLast3: string;
  pickupDate: string | null;
  pickupSlotMinutes: number | null;
  deliveryEtaDate: string | null;
  shippingLabel: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingSuburb: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
  shippingNote: string | null;
  subtotal: number; // cents
  surchargeTotal: number; // cents
  deliveryFee: number; // cents
  total: number; // cents
  requiresAgeCheck: boolean;
  rejectReason: string | null;
  posInvoiceSerial: string | null;
  version: number;
  placedAt: string; // ISO
  acceptedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  scheduledAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  createdAt: string; // ISO
  dueAt: string | null; // ISO — 서버 계산, 재계산 금지
  triage?: OrderTriageWire;
  refundRequests?: RefundRequestWire[]; // createdAt asc (환불 티켓 스펙 §5.2)
  lines: OrderLineWire[];
  events: OrderEventWire[];
} & OrderAutoVoidWire;

// --- 2026-09-24 매장 주문 트리아지 (crm order-triage.ts 정본) ---
// POS 는 분류하지 않는다 — crm 이 준 bucket/issues/issueText 를 그대로 그린다.
export type TriageBucketWire =
  | "new"
  | "pickup.today"
  | "pickup.ready"
  | "pickup.upcoming"
  | "delivery.today"
  | "delivery.out"
  | "delivery.tomorrow"
  | "delivery.upcoming";

export type TriageIssueKindWire =
  | "ACCEPT_OVERDUE"
  | "NOT_SCHEDULED"
  | "PAYMENT_FAILED"
  | "AUTO_VOID_SOON"
  | "PICKUP_NOT_READY"
  | "NOT_COLLECTED"
  | "DELIVERY_LATE";

export type OrderTriageWire = {
  bucket: TriageBucketWire | null; // 종결 = null
  issues: TriageIssueKindWire[];
  issueText: string[]; // issues 와 같은 순서·길이
};

// GET /device/order/buckets result (트리아지 스펙 §4.1).
export type OrderBucketsWire = {
  asOf: string;
  today: string;
  nextDeliveryDate: string | null;
  deliveryWindow: { startMinutes: number | null; endMinutes: number | null };
  counts: {
    new: { total: number; pickup: number; delivery: number };
    issues: { total: number; byKind: Record<TriageIssueKindWire, number> };
    pickup: { today: number; ready: number; upcoming: number };
    delivery: {
      today: number;
      out: number;
      tomorrow: number;
      upcoming: number;
      tomorrowToSchedule: number;
      tomorrowScheduled: number;
    };
  };
};

// --- 환불 요청 티켓 (환불 티켓 스펙 §5.2 RefundRequestDeviceDto) ---
export type RefundRequestReasonWire =
  | "REJECTED_AFTER_CAPTURE"
  | "PICKING_SHORTFALL"
  | "CUSTOMER_REQUEST"
  | "OTHER";

// POS 가 수동으로 올릴 수 있는 사유 — REJECTED_AFTER_CAPTURE 는 SYSTEM 전용(crm 400).
export const MANUAL_REFUND_REQUEST_REASONS = [
  "PICKING_SHORTFALL",
  "CUSTOMER_REQUEST",
  "OTHER",
] as const;

export type RefundRequestWire = {
  id: number;
  reason: RefundRequestReasonWire;
  status: "OPEN" | "COMPLETED" | "DECLINED";
  requestedAmount: number; // cents
  processedAmount: number | null;
  note: string;
  source: "POS" | "RUNNER" | "SYSTEM";
  sourceTerminal: string;
  requestedByName: string;
  lines: { orderLineId: number; name_en: string; qty: number; amount: number }[];
  declineReason: string | null;
  processedAt: string | null;
  createdAt: string;
  processing: boolean;
};

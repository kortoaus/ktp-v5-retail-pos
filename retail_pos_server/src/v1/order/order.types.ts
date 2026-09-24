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
  refundDue: boolean;
  lastError: string | null; // 캡처 실패 등 현장 표시용 코드 (예: AUTH_EXPIRED)
};

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
  stripePaymentIntentId: string | null;
  lastError: string | null;
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
  // 서버(crm) 계산 마감 시각. POS 는 비교/표시만 한다 — 재계산 금지.
  dueAt: string | null; // ISO
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
  lines: OrderLineWire[];
  events: OrderEventWire[];
} & OrderAutoVoidWire;

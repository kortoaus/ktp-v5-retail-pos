// Order inbox (slice A) — crm-server /device/order 프록시 wire 타입.
// 정본은 crm-server 의 RetailOrderAdminSummaryDto + dueAt. POS 는 재계산하지
// 않고 그대로 전달한다 (스펙 2026-08-10-pos-order-inbox-design.md).

export type OrderStatusWire =
  | "PLACED"
  | "ACCEPTED"
  | "READY"
  | "COLLECTED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export type OrderFulfillmentWire = "CLICK_AND_COLLECT" | "DELIVERY";

export type OrderSummaryWire = {
  id: number;
  orderNo: string;
  status: OrderStatusWire;
  fulfillment: OrderFulfillmentWire;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID";
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
};

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
  paymentStatus: "UNPAID" | "PAID";
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
  createdAt: string; // ISO
  dueAt: string | null; // ISO — 서버 계산, 재계산 금지
  lines: OrderLineWire[];
  events: OrderEventWire[];
};

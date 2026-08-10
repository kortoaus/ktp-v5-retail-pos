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

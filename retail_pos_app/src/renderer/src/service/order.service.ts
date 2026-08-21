// Order inbox (slice A) — local server /api/order 프록시 소비.
// 목록은 항상 실시간 프록시(crm /device/order)이며 로컬 캐시가 없다.
// dueAt 은 서버 계산 값 — 여기서는 비교/표시만 한다 (재계산 금지).

import apiService, { ApiResponse } from "../libs/api";

export type OrderStatus =
  | "PLACED"
  | "ACCEPTED"
  | "READY"
  | "COLLECTED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export type OrderFulfillment = "CLICK_AND_COLLECT" | "DELIVERY";

export type OrderPreset = "new" | "dueSoon" | "today" | "active" | "history";

export interface OrderSummary {
  id: number;
  orderNo: string;
  status: OrderStatus;
  fulfillment: OrderFulfillment;
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
  deliveryEtaDate: string | null; // "YYYY-MM-DD"
  shippingSuburb: string | null;
  shippingPostcode: string | null;
  placedAt: string; // ISO
  version: number;
  dueAt: string | null; // ISO — server-computed
}

export const getOrders = async (
  qs: string,
): Promise<ApiResponse<OrderSummary[]>> => {
  return await apiService.get<OrderSummary[]>(`/api/order${qs}`);
};

// --- 슬라이스 B: 상세 + 전이 ---
// 정본은 crm-server mapRetailOrderAdminDetail + dueAt (로컬 서버는 프록시).
// 상세는 요약형과 달리 lineCount/firstLineName* 이 없고 lines/events 전체.
// 전이 충돌은 status 409 / msg "TRANSITION_CONFLICT" — 상세 재조회로
// 실상태를 학습한다 (스펙 2026-08-13).

export interface OrderLineOption {
  sourceOptionGroupId: number;
  sourceOptionItemId: number;
  groupName_en: string;
  groupName_ko: string;
  optionName_en: string;
  optionName_ko: string;
  priceDelta: number; // 단위당 cents
  qty: number;
}

export interface OrderLine {
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
  // S2 러너 피킹 확정 수량 (EA 정수). null = 미기록. READY 로드 시 이 값을
  // 쓴다 (0 라인은 제외 — 스펙 §1.2).
  pickedQty: number | null;
  // 판별자(오너 확정): options.length > 0 = Made to Order, 아니면 Picking.
  options: OrderLineOption[];
}

export interface OrderEvent {
  type: string;
  actorType: string;
  actorLabel: string;
  note: string;
  createdAt: string; // ISO
}

export interface OrderDetail {
  id: number;
  orderNo: string;
  fulfillment: OrderFulfillment;
  status: OrderStatus;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID";
  memberId: string;
  memberName: string;
  memberPhoneLast3: string;
  pickupDate: string | null; // "YYYY-MM-DD"
  pickupSlotMinutes: number | null; // minute-of-day
  deliveryEtaDate: string | null; // "YYYY-MM-DD"
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
  dueAt: string | null; // ISO — server-computed
  lines: OrderLine[];
  events: OrderEvent[];
}

export const getOrder = async (
  id: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.get<OrderDetail>(`/api/order/${id}`);
};

export const acceptOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/accept`, {
    version,
  });
};

export const readyOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/ready`, {
    version,
  });
};

export const rejectOrder = async (
  id: number,
  version: number,
  reason: string,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/reject`, {
    version,
    reason,
  });
};

// --- 슬라이스 C: 인쇄 기록 ---
// 인쇄 성공 후 best-effort 기록 — 실패해도 인쇄 흐름을 막지 않는다
// (호출부 console.error only). 전이가 아니므로 version 없음, 종결 주문에도
// 허용(재인쇄). 응답은 전이와 동일한 갱신된 상세 DTO.

export type OrderPrintedBody =
  | { kind: "picklist" }
  | { kind: "label"; lineId: number };

export const recordOrderPrinted = async (
  id: number,
  body: OrderPrintedBody,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/printed`, body);
};

export type RevealedMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

// 전화 리빌 — 주문 스코프 프록시. 공개된 번호는 호출측 로컬 state 에만
// 보관할 것(캐시/스토리지 금지 — web client MemberDetail 불변식과 동일).
export const revealOrderMemberPhone = async (
  id: number,
): Promise<ApiResponse<RevealedMemberPhone>> => {
  return await apiService.post<RevealedMemberPhone>(
    `/api/order/${id}/member-phone`,
  );
};


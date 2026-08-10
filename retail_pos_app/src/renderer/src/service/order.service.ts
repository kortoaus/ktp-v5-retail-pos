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

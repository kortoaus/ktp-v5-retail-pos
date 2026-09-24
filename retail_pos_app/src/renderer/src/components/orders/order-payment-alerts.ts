// 온라인 결제(Stripe) 현장 배지 규칙 — 목록(OrderSearchPanel)과 디테일
// (OrderViewerSummary) 공용 순수 함수 (2026-09-24 crm 스펙 §4.5·§6.2·§7).
// 모든 판정 값은 crm 서버 계산(payment.lastError/refundDue, autoVoidAt/
// autoVoidSoon) — 여기서는 표시 문구만 만든다(재계산 금지). IN_STORE 주문은
// 배지 없음. 현장 UI 는 영문.

import type {
  OrderPaymentMethod,
  OrderPaymentState,
  OrderPaymentSummary,
} from "../../service/order.service";

export type OrderPaymentAlertTone = "red" | "amber";

export interface OrderPaymentAlert {
  key: "captureFailed" | "refundDue" | "autoVoidSoon";
  label: string;
  tone: OrderPaymentAlertTone;
}

interface OrderPaymentAlertInput {
  paymentMethod: "IN_STORE" | "STRIPE";
  payment: OrderPaymentSummary;
  autoVoidAt: string | null;
  autoVoidSoon: boolean;
}

export function getOrderPaymentAlerts(
  order: OrderPaymentAlertInput,
  nowMs: number,
): OrderPaymentAlert[] {
  if (order.paymentMethod !== "STRIPE") return [];
  const alerts: OrderPaymentAlert[] = [];
  const lastError = order.payment.lastError;
  if (lastError) {
    alerts.push({
      key: "captureFailed",
      label:
        lastError === "AUTH_EXPIRED"
          ? "Card hold expired"
          : `Payment failed (${lastError})`,
      tone: "red",
    });
  }
  if (order.payment.refundDue) {
    alerts.push({ key: "refundDue", label: "Refund due", tone: "red" });
  }
  if (order.autoVoidSoon && order.autoVoidAt) {
    const hoursLeft = Math.max(
      0,
      Math.ceil((new Date(order.autoVoidAt).getTime() - nowMs) / 3_600_000),
    );
    alerts.push({
      key: "autoVoidSoon",
      label: `Auto-cancels in ${hoursLeft}h — schedule now`,
      tone: "amber",
    });
  }
  return alerts;
}

// STRIPE 주문 결제 상태 표시 문구 (디테일 요약 행). IN_STORE 는 기존 표시 없음.
const PAYMENT_STATE_LABELS: Record<OrderPaymentState, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  PENDING: "Card payment not completed",
  AUTHORIZED: "Card authorised — charged on Schedule",
  CAPTURED: "Charged to card",
  VOIDED: "Card hold released — not charged",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
};

export function getOrderPaymentStateLabel(state: OrderPaymentState): string {
  return PAYMENT_STATE_LABELS[state] ?? state;
}

// 결제수단 한 줄 — "Visa •••• 4242" / "Apple Pay (Visa •••• 4242)". 미기록 = null.
const CARD_BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  eftpos_au: "eftpos",
};
const WALLET_LABELS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

export function formatOrderPaymentMethod(
  method: OrderPaymentMethod | null | undefined,
): string | null {
  if (!method) return null;
  const raw = method.brand?.trim() ?? "";
  const brand = raw
    ? CARD_BRAND_LABELS[raw.toLowerCase()] ??
      raw.charAt(0).toUpperCase() + raw.slice(1)
    : null;
  const card = [brand, method.last4 ? `•••• ${method.last4}` : null]
    .filter(Boolean)
    .join(" ");
  const wallet = method.wallet ? (WALLET_LABELS[method.wallet] ?? null) : null;
  if (wallet) return card ? `${wallet} (${card})` : wallet;
  return card || null;
}

// 이미 청구된 STRIPE 주문인가 — reject 경고 문구 분기용 (스펙 §6.4).
export function isOrderCharged(order: {
  paymentMethod: "IN_STORE" | "STRIPE";
  payment: OrderPaymentSummary;
}): boolean {
  return (
    order.paymentMethod === "STRIPE" &&
    (order.payment.state === "CAPTURED" ||
      order.payment.state === "PARTIALLY_REFUNDED")
  );
}

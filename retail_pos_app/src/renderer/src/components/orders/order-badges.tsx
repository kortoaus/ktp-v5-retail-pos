// 주문 상태/수령방식 배지 — 목록(OrderSearchPanel)과 디테일(OrderViewer)
// 공용. 슬라이스 A 의 Panel 내장 배지를 B 에서 파일로 분리한 것.

import { cn } from "../../libs/cn";
import type {
  OrderFulfillment,
  OrderStatus,
} from "../../service/order.service";
import type { OrderPaymentAlert } from "./order-payment-alerts";

export function FulfillmentBadge({
  fulfillment,
}: {
  fulfillment: OrderFulfillment;
}) {
  const isCnc = fulfillment === "CLICK_AND_COLLECT";
  return (
    <span
      className={cn(
        "w-12 shrink-0 text-center text-[10px] font-bold px-1.5 py-1 rounded tracking-wider",
        isCnc ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700",
      )}
    >
      {isCnc ? "C&C" : "DLV"}
    </span>
  );
}

const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "bg-gray-100 text-gray-500",
  PLACED: "bg-orange-100 text-orange-700",
  ACCEPTED: "bg-blue-100 text-blue-700",
  READY: "bg-emerald-100 text-emerald-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  DISPATCHED: "bg-violet-100 text-violet-700",
  DELIVERED: "bg-gray-100 text-gray-600",
  COLLECTED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-gray-200 text-gray-500",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-red-100 text-red-700",
  ABANDONED: "bg-gray-200 text-gray-500",
};

// 배지 문구 — enum 원문이 길거나 내부용인 것만 짧은 영문으로 (w-24 고정폭).
const STATUS_BADGE_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "UNPAID",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "w-24 shrink-0 text-center text-[10px] font-bold px-2 py-1 rounded tracking-wider",
        STATUS_BADGE_CLASSES[status],
      )}
    >
      {STATUS_BADGE_LABELS[status] ?? status}
    </span>
  );
}

// 온라인 결제 경고 배지 (캡처 실패·환불 필요·자동취소 임박) — 규칙은
// order-payment-alerts.ts (서버 계산 값의 표시만).
export function PaymentAlertBadge({ alert }: { alert: OrderPaymentAlert }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[10px] font-bold px-2 py-1 rounded tracking-wide whitespace-nowrap",
        alert.tone === "red"
          ? "bg-red-600 text-white"
          : "bg-amber-400 text-amber-950",
      )}
    >
      {alert.label}
    </span>
  );
}

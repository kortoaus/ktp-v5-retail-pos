// 주문 상태/수령방식 배지 — 목록(OrderSearchPanel)과 디테일(OrderViewer)
// 공용. 슬라이스 A 의 Panel 내장 배지를 B 에서 파일로 분리한 것.

import { cn } from "../../libs/cn";
import type {
  OrderFulfillment,
  OrderStatus,
} from "../../service/order.service";

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
  PLACED: "bg-orange-100 text-orange-700",
  ACCEPTED: "bg-blue-100 text-blue-700",
  READY: "bg-emerald-100 text-emerald-700",
  COLLECTED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-gray-200 text-gray-500",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "w-24 shrink-0 text-center text-[10px] font-bold px-2 py-1 rounded tracking-wider",
        STATUS_BADGE_CLASSES[status],
      )}
    >
      {status}
    </span>
  );
}

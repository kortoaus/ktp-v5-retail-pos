// OrderViewer ⑥ 하단 액션 바 — getVisibleOrderStatusActions 결과만 h-14
// 버튼으로 노출(유효하지 않은 전이는 미표시, 비활성 아님). disabled 는
// 공유 in-flight boolean 하나 (v1 관례). onPointerDown 만 사용(스캐너 트랩).

import type { OrderStatus } from "../../service/order.service";
import {
  getVisibleOrderStatusActions,
  type OrderStatusAction,
} from "./order-status-policy";

const ACTION_LABELS: Record<OrderStatusAction, string> = {
  ACCEPTED: "Accept",
  READY: "Ready",
  REJECTED: "Reject",
};

export default function OrderViewerActionBar({
  status,
  userScopes,
  inFlight,
  onAction,
}: {
  status: OrderStatus;
  userScopes: readonly string[];
  inFlight: boolean;
  onAction: (action: OrderStatusAction) => void;
}) {
  const actions = getVisibleOrderStatusActions(status, userScopes);
  if (actions.length === 0) return null;

  return (
    <div className="sticky bottom-0 bg-white border-t border-gray-300 p-3 flex gap-3">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          disabled={inFlight}
          onPointerDown={() => onAction(action)}
          className={
            "flex-1 h-14 rounded-lg text-lg font-bold text-white disabled:opacity-40 " +
            (action === "REJECTED" ? "bg-red-600" : "bg-blue-600")
          }
        >
          {inFlight ? "..." : ACTION_LABELS[action]}
        </button>
      ))}
    </div>
  );
}

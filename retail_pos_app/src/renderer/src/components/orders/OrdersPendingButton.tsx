// SaleScreen 상단 배지 — 구 PickupPendingCountButton 의 부활판.
// 자체 소켓 대신 orderInboxStore(OrderNotification 이 공급)를 읽는다.

import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../libs/cn";
import { getOrderInboxState, subscribeOrderInbox } from "./orderInboxStore";

export default function OrdersPendingButton() {
  const navigate = useNavigate();
  const { connected, payload } = useSyncExternalStore(
    subscribeOrderInbox,
    getOrderInboxState,
  );

  const count = payload?.count ?? null;
  const label = count != null ? `Orders: ${count}` : "Orders: -";

  return (
    <button
      type="button"
      onPointerDown={() => navigate("/manager/orders")}
      className={cn(
        "h-9 min-w-[110px] whitespace-nowrap rounded-lg border px-3 text-sm font-bold tabular-nums",
        !connected
          ? "border-gray-200 bg-gray-100 text-gray-500 opacity-70"
          : count != null && count > 0
            ? "border-orange-300 bg-orange-50 text-orange-700 active:bg-orange-100"
            : "border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100",
      )}
      title={connected ? "Open order inbox" : "Socket reconnecting"}
    >
      {label}
    </button>
  );
}

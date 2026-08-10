// OrdersScreen — 주문 수신함 (슬라이스 A: 알림 + 목록, 조회 전용).
// Screen+Panel 관례 (모델: SaleInvoiceSearchScreen). 뷰어/디테일 없음 — B 에서.

import { useNavigate } from "react-router-dom";
import OrderSearchPanel from "../components/orders/OrderSearchPanel";
import BlockScreen from "../components/BlockScreen";
import hasScope from "../libs/scope-utils";
import { useUser } from "../contexts/UserContext";

export default function OrdersScreen() {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useUser();

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["sale"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Orders</h1>
      </div>

      <div className="flex-1 min-h-0">
        <OrderSearchPanel />
      </div>
    </div>
  );
}

// OrdersScreen — 주문 수신함. Screen+Panel+Viewer 관례
// (모델: SaleInvoiceSearchScreen). 행 탭 → OrderViewer(디테일+전이, 슬라이스 B).
// 전이 성공(onChanged) → refreshKey 증가 → Panel 이 현재 페이지 재조회.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import OrderSearchPanel from "../components/orders/OrderSearchPanel";
import OrderViewer from "../components/orders/OrderViewer";
import BlockScreen from "../components/BlockScreen";
import hasScope from "../libs/scope-utils";
import { useUser } from "../contexts/UserContext";

export default function OrdersScreen() {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useUser();
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
        <OrderSearchPanel
          onSelect={setViewingOrderId}
          refreshKey={refreshKey}
        />
      </div>

      <OrderViewer
        orderId={viewingOrderId}
        onClose={() => setViewingOrderId(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

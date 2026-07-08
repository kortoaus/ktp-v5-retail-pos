import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BlockScreen from "../components/BlockScreen";
import PickupOrderSearchPanel, {
  type PickupOrderSearchPanelHandle,
} from "../components/pickupOrders/PickupOrderSearchPanel";
import PickupOrderViewer from "../components/pickupOrders/PickupOrderViewer";
import type {
  PickupOrderListSort,
  PickupOrderStatusFilter,
} from "../components/pickupOrders/pickup-order-types";
import { useUser } from "../contexts/UserContext";
import dayjsAU from "../libs/dayjsAU";
import hasScope from "../libs/scope-utils";

export default function PickupOrderSearchScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useUser();
  const [viewerCrmOrderId, setViewerCrmOrderId] = useState<number | null>(null);
  const searchPanelRef = useRef<PickupOrderSearchPanelHandle | null>(null);
  const initialStatusFilter: PickupOrderStatusFilter =
    searchParams.get("status") === "PENDING" ? "PENDING" : "ALL";
  const fromParam = searchParams.get("from");
  const initialFrom = fromParam ? dayjsAU(fromParam) : null;
  const sortParam = searchParams.get("sort");
  const initialSort: PickupOrderListSort =
    sortParam === "pickupStartsAtAsc"
      ? "pickupStartsAtAsc"
      : "pickupStartsAtDesc";

  if (!user || !hasScope(user.scope, ["sale"])) {
    return <BlockScreen />;
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          Back
        </button>
        <h1 className="text-lg font-bold">Pickup Orders</h1>
      </div>

      <div className="flex-1 min-h-0">
        <PickupOrderSearchPanel
          ref={searchPanelRef}
          initialStatusFilter={initialStatusFilter}
          initialFrom={initialFrom?.isValid() ? initialFrom : null}
          initialSort={initialSort}
          onSelect={(order) => setViewerCrmOrderId(order.crmOrderId)}
        />
      </div>

      <PickupOrderViewer
        crmOrderId={viewerCrmOrderId}
        onClose={() => setViewerCrmOrderId(null)}
        onPrinted={(crmOrderId) =>
          searchPanelRef.current?.markPrinted(crmOrderId)
        }
        onStatusChanged={(crmOrderId, status) =>
          searchPanelRef.current?.markStatusChanged(crmOrderId, status)
        }
        onRefreshList={() => searchPanelRef.current?.refreshCurrentPage()}
      />
    </div>
  );
}

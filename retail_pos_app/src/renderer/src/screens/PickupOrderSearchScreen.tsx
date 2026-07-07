import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BlockScreen from "../components/BlockScreen";
import PickupOrderSearchPanel from "../components/pickupOrders/PickupOrderSearchPanel";
import PickupOrderViewer from "../components/pickupOrders/PickupOrderViewer";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";

export default function PickupOrderSearchScreen() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [viewerCrmOrderId, setViewerCrmOrderId] = useState<number | null>(null);

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
          onSelect={(order) => setViewerCrmOrderId(order.crmOrderId)}
        />
      </div>

      <PickupOrderViewer
        crmOrderId={viewerCrmOrderId}
        onClose={() => setViewerCrmOrderId(null)}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { LINE_PAGE_SIZE, useSalesStore } from "../store/salesStore";
import { CloudPost, StoreSetting } from "../types/models";
import CustomerIdleScreen from "./CustomerIdleScreen";
import SaleScreenLineViewer from "../screens/SaleScreen/SaleScreenLineViewer";
import DocumentMonitor from "../screens/SaleScreen/DocumentMonitor";
import { MONEY_DP } from "../libs/constants";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export default function CustomerScreen() {
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const [posts, setPosts] = useState<CloudPost[]>([]);

  useEffect(() => {
    // Listen for cart pushes from main window
    const cartChannel = new BroadcastChannel("pos-cart");
    cartChannel.onmessage = (event) => {
      const { carts, activeCartIndex, lineOffset } = event.data;
      useSalesStore.setState({ carts, activeCartIndex, lineOffset });
    };

    // Listen for data responses from main window
    const dataChannel = new BroadcastChannel("pos-customer-data");
    dataChannel.onmessage = (event) => {
      const { storeSetting: ss, posts: p } = event.data;
      if (ss) setStoreSetting(ss);
      if (p) setPosts(p);
    };

    // Request refresh on mount + every 10 minutes
    const requestRefresh = () => {
      const ch = new BroadcastChannel("pos-refresh");
      ch.postMessage("refresh");
      ch.close();
    };

    requestRefresh();
    const timer = setInterval(requestRefresh, REFRESH_INTERVAL_MS);

    return () => {
      cartChannel.close();
      dataChannel.close();
      clearInterval(timer);
    };
  }, []);

  const { carts, activeCartIndex, lineOffset } = useSalesStore();
  const lines = useMemo(() => {
    return carts[activeCartIndex]?.lines ?? [];
  }, [carts, activeCartIndex]);
  const discounts = useMemo(() => {
    return carts[activeCartIndex]?.discounts ?? [];
  }, [carts, activeCartIndex]);
  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  if (lines.length === 0) {
    return <CustomerIdleScreen storeSetting={storeSetting} posts={posts} />;
  }

  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-white">
          <SaleScreenLineViewer
            lines={lines}
            lineOffset={lineOffset}
            maxOffset={maxOffset}
            selectedLineKey={null}
            setSelectedLineKey={() => {}}
          />
        </div>
        {discounts.length > 0 && (
          <div className="w-[300px] bg-white border-l border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 bg-green-50">
              <div className="text-sm font-bold text-green-700">
                Discounts ({discounts.length})
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 px-4">
              {discounts.map((d) => (
                <div
                  key={`${d.entityType}-${d.entityId}`}
                  className="py-3"
                >
                  <div className="text-sm font-medium truncate">
                    {d.title}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {d.description}
                  </div>
                  <div className="text-green-600 font-bold text-sm mt-1">
                    -${d.amount.toFixed(MONEY_DP)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="h-24">
        <DocumentMonitor />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useSalesStore, LINE_PAGE_SIZE } from "../store/SalesStore";
import { CloudPost, StoreSetting } from "../types/models";
import CustomerIdleScreen from "./CustomerIdleScreen";
import LineViewer from "../screens/SaleScreen/LineViewer";
import DocumentMonitor from "../screens/SaleScreen/DocumentMonitor";
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export default function CustomerScreen() {
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const [posts, setPosts] = useState<CloudPost[]>([]);

  useEffect(() => {
    const cartChannel = new BroadcastChannel("pos-cart");
    cartChannel.onmessage = (event) => {
      const { carts, activeCartIndex, lineOffset } = event.data;
      useSalesStore.setState({
        carts,
        activeCartIndex,
        lineOffset,
      });
    };

    const dataChannel = new BroadcastChannel("pos-customer-data");
    dataChannel.onmessage = (event) => {
      const { storeSetting: ss, posts: p } = event.data;
      if (ss) setStoreSetting(ss);
      if (p) setPosts(p);
    };

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

  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  if (lines.length === 0) {
    return <CustomerIdleScreen storeSetting={storeSetting} posts={posts} />;
  }

  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-white">
          <LineViewer
            lines={lines}
            lineOffset={lineOffset}
            selectedLineKey={null}
            setSelectedLineKey={() => {}}
          />
        </div>
      </div>
      <div className="h-24">
        <DocumentMonitor />
      </div>
    </div>
  );
}

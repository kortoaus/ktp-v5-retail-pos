import { useEffect, useMemo, useState } from "react";
import { LINE_PAGE_SIZE, useSalesStore } from "../store/salesStore";
import { CloudPost, StoreSetting } from "../types/models";
import CustomerIdleScreen from "./CustomerIdleScreen";
import SaleScreenLineViewer from "../screens/SaleScreen/SaleScreenLineViewer";
import DocumentMonitor from "../screens/SaleScreen/DocumentMonitor";

export default function CustomerScreen() {
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const [posts, setPosts] = useState<CloudPost[]>([]);

  useEffect(() => {
    const cartChannel = new BroadcastChannel("pos-cart");
    cartChannel.onmessage = (event) => {
      const { carts, activeCartIndex, lineOffset } = event.data;
      useSalesStore.setState({ carts, activeCartIndex, lineOffset });
    };

    const storeChannel = new BroadcastChannel("pos-store");
    storeChannel.onmessage = (event) => {
      setStoreSetting(event.data.storeSetting);
    };

    const postsChannel = new BroadcastChannel("pos-posts");
    postsChannel.onmessage = (event) => {
      setPosts(event.data.posts);
    };

    return () => {
      cartChannel.close();
      storeChannel.close();
      postsChannel.close();
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
      <div className="flex-1 bg-white">
        <SaleScreenLineViewer
          lines={lines}
          lineOffset={lineOffset}
          maxOffset={maxOffset}
          selectedLineKey={null}
          setSelectedLineKey={() => {}}
        />
      </div>
      <div className="h-16">
        <DocumentMonitor />
      </div>
    </div>
  );
}

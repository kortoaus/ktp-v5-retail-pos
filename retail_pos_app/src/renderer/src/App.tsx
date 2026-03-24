import { HashRouter, Routes, Route } from "react-router-dom";
import Gateway from "./components/Gateway";
import { TerminalProvider } from "./contexts/TerminalContext";
import ManagerLayout from "./layouts/ManagerLayout";
import InterfaceSettingsScreen from "./screens/InterfaceSettingsScreen";
import LabelingScreen from "./screens/LabelingScreen";
import WeightLabelScreen from "./screens/WeightLabelScreen";
import NewSaleScreen from "./screens/NewSaleScreen";
import TestScreen from "./screens/TestScreen";
import HomeScreen from "./screens/HomeScreen";
import HotkeyManagerScreen from "./screens/HotkeyManagerScreen";
import UserManageScreen from "./screens/UserManageScreen";
import ServerSetupScreen from "./screens/ServerSetupScreen";
import OpenShiftScreen from "./screens/OpenShiftScreen";
import SaleInvoiceSearchScreen from "./screens/SaleInvoiceSearchScreen";
import { ShiftProvider } from "./contexts/ShiftContext";
import RefundScreen from "./screens/RefundScreen";
import CashIOManageScreen from "./screens/CashIOManageScreen";
import StoreSettingScreen from "./screens/StoreSettingScreen";
import CloseShiftScreen from "./screens/CloseShiftScreen";
import CustomerScreen from "./components/CustomerScreen";
import { useCartBroadcast } from "./hooks/useCartBroadcast";
import { useStoreSetting } from "./hooks/useStoreSetting";
import { getCloudPosts } from "./service/cloud.service";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudPost } from "./types/models";

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/customer-display" element={<CustomerScreen />} />
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </HashRouter>
  );
}

function MainApp() {
  useCartBroadcast();
  return (
    <TerminalProvider>
      <ShiftProvider>
        <Gateway>
          <CustomerDisplayBroadcast />
          <Routes>
            <Route path="/" element={<HomeScreen />} />

            <Route path="/labeling" element={<LabelingScreen />} />
            <Route path="/weight-label" element={<WeightLabelScreen />} />
            <Route path="/server-setup" element={<ServerSetupScreen />} />

            <Route path="/sale" element={<ManagerLayout />}>
              <Route path="" element={<NewSaleScreen />} />
            </Route>
            <Route path="/manager" element={<ManagerLayout />}>
              <Route path="settings" element={<InterfaceSettingsScreen />} />
              <Route path="test" element={<TestScreen />} />
              <Route path="hotkey" element={<HotkeyManagerScreen />} />
              <Route path="user" element={<UserManageScreen />} />
              <Route path="invoices" element={<SaleInvoiceSearchScreen />} />
              <Route path="refund" element={<RefundScreen />} />
              <Route path="cashio" element={<CashIOManageScreen />} />
              <Route path="store" element={<StoreSettingScreen />} />
            </Route>

            <Route path="/shift" element={<ManagerLayout />}>
              <Route path="open" element={<OpenShiftScreen />} />
              <Route path="close" element={<CloseShiftScreen />} />
            </Route>
          </Routes>
        </Gateway>
      </ShiftProvider>
    </TerminalProvider>
  );
}

function CustomerDisplayBroadcast() {
  const { storeSetting } = useStoreSetting();
  const [posts, setPosts] = useState<CloudPost[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const { result, ok } = await getCloudPosts();
      if (ok && result) setPosts(result);
    } catch (e) {
      console.error("Failed to fetch posts", e);
    }
  }, []);

  // Fetch posts on mount
  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Listen for refresh requests from customer screen or SyncPostButton
  useEffect(() => {
    channelRef.current = new BroadcastChannel("pos-refresh");
    channelRef.current.onmessage = () => {
      fetchPosts();
    };
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [fetchPosts]);

  // Broadcast storeSetting + posts whenever they change
  useEffect(() => {
    if (!storeSetting) return;
    const responseChannel = new BroadcastChannel("pos-customer-data");
    responseChannel.postMessage({ storeSetting, posts });
    responseChannel.close();
  }, [storeSetting, posts]);

  return null;
}

export default App;

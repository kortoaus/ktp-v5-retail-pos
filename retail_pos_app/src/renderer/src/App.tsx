import { HashRouter, Routes, Route } from "react-router-dom";
import Gateway from "./components/Gateway";
import { TerminalProvider } from "./contexts/TerminalContext";
import { useTerminal } from "./contexts/TerminalContext";
import ManagerLayout from "./layouts/ManagerLayout";
import InterfaceSettingsScreen from "./screens/InterfaceSettingsScreen";
import LabelingScreen from "./screens/LabelingScreen";
import SaleScreen from "./screens/SaleScreen";
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
import { useEffect, useRef } from "react";

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
          <StoreSettingBroadcast />
          <Routes>
            <Route path="/" element={<HomeScreen />} />

            <Route path="/labeling" element={<LabelingScreen />} />
            <Route path="/server-setup" element={<ServerSetupScreen />} />

            <Route path="/sale" element={<ManagerLayout />}>
              <Route path="" element={<SaleScreen />} />
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

function StoreSettingBroadcast() {
  const { company } = useTerminal();
  const { storeSetting } = useStoreSetting();
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel("pos-store");
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!storeSetting || !company || !channelRef.current) return;
    channelRef.current.postMessage({ storeSetting, company });
  }, [storeSetting, company]);
  return null;
}

export default App;

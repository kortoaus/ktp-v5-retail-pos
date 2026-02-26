import { HashRouter, Routes, Route } from "react-router-dom";
import Gateway from "./components/Gateway";
import { TerminalProvider } from "./contexts/TerminalContext";
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

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <TerminalProvider>
        <ShiftProvider>
          <Gateway>
            <Routes>
              <Route path="/" element={<HomeScreen />} />

              <Route path="/sale" element={<SaleScreen />} />
              <Route path="/labeling" element={<LabelingScreen />} />
              <Route path="/server-setup" element={<ServerSetupScreen />} />

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
    </HashRouter>
  );
}

export default App;

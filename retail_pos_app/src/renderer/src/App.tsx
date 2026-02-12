import { HashRouter, Routes, Route } from "react-router-dom";
import Gateway from "./components/Gateway";
import { TerminalProvider } from "./contexts/TerminalContext";
import InterfaceSettingsScreen from "./screens/InterfaceSettingsScreen";
import LabelingScreen from "./screens/LabelingScreen";
import SaleScreen from "./screens/SaleScreen";
import OnScreenKeyboardTestScreen from "./screens/OnScreenKeyboardTestScreen";

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <TerminalProvider>
        <Gateway>
          <Routes>
            <Route path="/" element={<SaleScreen />} />
            <Route path="/settings" element={<InterfaceSettingsScreen />} />
            <Route path="/labeling" element={<LabelingScreen />} />
          </Routes>
        </Gateway>
      </TerminalProvider>
    </HashRouter>
  );
}

export default App;

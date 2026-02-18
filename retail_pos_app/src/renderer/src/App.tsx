import { HashRouter, Routes, Route } from "react-router-dom";
import Gateway from "./components/Gateway";
import { TerminalProvider } from "./contexts/TerminalContext";
import InterfaceSettingsScreen from "./screens/InterfaceSettingsScreen";
import LabelingScreen from "./screens/LabelingScreen";
import SaleScreen from "./screens/SaleScreen";
import TestScreen from "./screens/TestScreen";
import HomeScreen from "./screens/HomeScreen";

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <TerminalProvider>
        <Gateway>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/sale" element={<SaleScreen />} />
            <Route path="/settings" element={<InterfaceSettingsScreen />} />
            <Route path="/test" element={<TestScreen />} />
            <Route path="/labeling" element={<LabelingScreen />} />
          </Routes>
        </Gateway>
      </TerminalProvider>
    </HashRouter>
  );
}

export default App;

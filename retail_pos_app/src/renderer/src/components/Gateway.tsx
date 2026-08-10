import { useState, type ReactNode } from "react";
import { useTerminal } from "../contexts/TerminalContext";
import ServerSetupScreen from "../screens/ServerSetupScreen";
import DeviceMonitor from "./DeviceMonitor";
import { useShift } from "../contexts/ShiftContext";
import SyncButton from "./SyncButton";
import OrderNotification from "./orders/OrderNotification";

export default function Gateway({ children }: { children: ReactNode }) {
  const { shift, loading: shiftLoading } = useShift();
  const [serverSetup, setServerSetup] = useState(false);
  const { terminal, company, loading, serverConfigured, error, refetch } =
    useTerminal();

  if (loading || shiftLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!serverConfigured || serverSetup) {
    return <ServerSetupScreen />;
  }

  if (!terminal || !company) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-600 font-medium">Not Registered Terminal.</p>
        {error && <p className="text-sm text-gray-500">{error}</p>}
        <button
          onClick={refetch}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Retry
        </button>
        <SyncButton />
        <button
          onClick={() => setServerSetup(true)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Server Setup
        </button>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      {/* 주문 수신함 배너/차임 — flex 형제라 화면을 가리지 않고 밀어낸다 */}
      <OrderNotification />
      <div className="flex-1 h-full w-full overflow-y-auto">{children}</div>
      <DeviceMonitor
        terminal={terminal}
        company={company}
        shift={shift || null}
      />
    </div>
  );
}

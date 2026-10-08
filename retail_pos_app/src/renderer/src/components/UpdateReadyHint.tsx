import { useEffect, useState } from "react";
import { useSalesStore } from "../store/SalesStore";
import { isTillIdle } from "../store/till-idle";
import { checkoutsInFlight } from "../libs/checkout-inflight";

// T-24 (audit R-10) — answers main's "may the downloaded update install now?"
// (idle = no cart rows on any open sale, no checkout/refund in flight) and,
// once an update is waiting, shows a small non-blocking hint. Main re-asks
// every 60 s and installs at the first idle answer.
export default function UpdateReadyHint() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateCanInstall) return;
    return api.onUpdateCanInstall(() => {
      setReady(true);
      return isTillIdle(useSalesStore.getState().carts, checkoutsInFlight());
    });
  }, []);

  if (!ready) return null;
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded-md bg-gray-900/80 px-3 py-1 text-xs font-medium text-white">
      Update ready — installs when the till is idle
    </div>
  );
}

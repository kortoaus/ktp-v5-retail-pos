import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useScaleStatus } from "../../hooks/useScaleStatus";
import { cn } from "../../libs/cn";
import type { ScaleLabelStore } from "../../label-core/adapters/scale-label";
import { getStoreLabelSetting } from "../../service/store.service";
import { Item } from "../../types/models";
import ItemBrowsePanel from "./ItemBrowsePanel";
import WeighPanel from "./WeighPanel";

/**
 * The `/scale` station — the POS replacement for the retired `ktpv5-scale`
 * Android terminal.
 *
 * Two steps, browse → weigh, held as local state rather than nested routes:
 * the station is one job an operator repeats, and a URL for the middle of it
 * buys nothing (the item is re-fetched on entry either way).
 *
 * **No auth gate**, matching the legacy terminal and this app's routing: like
 * `/`, `/price-tag` and `/barcode-print`, `/scale` sits outside `ManagerLayout`
 * and therefore outside `UserProvider`. Whoever is at the scale is weighing;
 * the LAN is the security boundary.
 *
 * The `label-core` bench that used to own this path lives at `/scale/bench`,
 * reachable from the header here. The home screen's tile now points at the
 * station.
 */
export default function ScaleStationScreen() {
  const [selected, setSelected] = useState<Item | null>(null);
  const [store, setStore] = useState<ScaleLabelStore>({});
  const scaleConnected = useScaleStatus();

  // The 60 × 40 footer's store block. `GET /api/store/label` joins the address
  // server-side; a failure leaves the footer empty rather than blocking a
  // print, which is the right trade for a label whose stock is pre-printed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getStoreLabelSetting();
      if (!cancelled && res.ok && res.result) {
        setStore({ name: res.result.name, address: res.result.address });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-14 shrink-0 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link to="/" className="text-sm font-medium text-blue-600 active:text-blue-800">
          &larr; Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Scale</h1>
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-xs font-bold",
            scaleConnected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
          )}
        >
          {scaleConnected ? "Scale connected" : "Scale disconnected"}
        </span>
        {store.name && (
          <span className="text-xs text-gray-400 truncate">{store.name}</span>
        )}
        <div className="flex-1" />
        {/* Cashiers hop between packing and the till — keep the switch one tap
            (owner, 2026-08-28). /sale re-runs its own auth gate on entry. */}
        <Link
          to="/sale"
          className="h-9 px-3 flex items-center rounded-lg bg-blue-500 text-sm font-bold text-white active:bg-blue-600"
        >
          Sale
        </Link>
        <Link
          to="/scale/bench"
          className="h-9 px-3 flex items-center rounded-lg border border-gray-300 text-sm font-medium text-gray-600 active:bg-gray-100"
        >
          Bench
        </Link>
      </div>

      {/* Browse stays mounted; the weigh panel sits over it as an overlay so
          closing it returns to the same keyword/brand filter and scroll
          (owner, 2026-08-28). */}
      <div className="flex-1 min-h-0 relative">
        <ItemBrowsePanel onPick={setSelected} />
        {selected && (
          <div className="absolute inset-0 z-20 bg-white">
            <WeighPanel
              itemId={selected.id}
              store={store}
              onBack={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useWeight } from "../hooks/useWeight";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import SyncButton from "../components/SyncButton";

export default function TestScreen() {
  const { weight, connected, connect, disconnect, readWeight } = useWeight();
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  useBarcodeScanner((barcode) => setLastScanned(barcode));

  const handleConnect = async () => {
    const ok = await connect();
    if (!ok) alert("Failed to connect to scale");
  };

  return (
    <div className="h-full bg-gray-50 p-6">
      <div className="max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Device Test</h1>
          <Link
            to="/settings"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Settings
          </Link>
          <Link
            to="/labeling"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Labeling
          </Link>
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Scale</h2>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div className="flex gap-2">
            {!connected ? (
              <button
                onClick={handleConnect}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Connect
              </button>
            ) : (
              <>
                <button
                  onClick={readWeight}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Read Weight
                </button>
                <button
                  onClick={disconnect}
                  className="border border-gray-300 hover:border-gray-400 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <div className="text-4xl font-bold tabular-nums text-gray-900">
              {weight.weight.toFixed(3)}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {weight.unit} · {weight.status}
              {weight.message && ` · ${weight.message}`}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-base font-semibold text-gray-900">
            Barcode Scanner
          </h2>
          <p className="text-xs text-gray-500">
            Supports Datalogic serial and USB HID scanners.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <div className="text-lg font-mono font-semibold text-gray-900">
              {lastScanned ?? "—"}
            </div>
          </div>
        </section>
      </div>
      <SyncButton />
    </div>
  );
}

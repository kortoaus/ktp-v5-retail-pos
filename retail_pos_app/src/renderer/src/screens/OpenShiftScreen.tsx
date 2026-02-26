import { useState } from "react";
import { useNavigate } from "react-router-dom";
import CashCounter from "../components/CashCounter";
import OnScreenKeyboard from "../components/OnScreenKeyboard";
import BlockScreen from "../components/BlockScreen";
import { useShift } from "../contexts/ShiftContext";
import { MONEY_DP } from "../libs/constants";

export default function OpenShiftScreen() {
  const navigate = useNavigate();
  const { shift, openShift } = useShift();
  const [cashInDrawer, setCashInDrawer] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (shift) {
    return <BlockScreen label="Shift is already open" link="/sale" />;
  }

  const handleOpen = async () => {
    setLoading(true);
    try {
      const { ok, msg } = await openShift({
        openedNote: note.trim(),
        cashInDrawer: Math.round(cashInDrawer * 100),
        getBackItemIds: [],
        getBackOptionIds: [],
        isPublicHoliday: false,
      });
      if (ok) {
        navigate("/sale");
      } else {
        window.alert(msg || "Failed to open shift");
      }
    } catch {
      window.alert("Failed to open shift");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200">
        <h1 className="text-xl font-bold">Open Shift</h1>
        <div className="flex items-center gap-3">
          <span className="text-lg font-medium">
            Drawer: ${cashInDrawer.toFixed(MONEY_DP)}
          </span>
          <button
            onClick={() => navigate(-1)}
            disabled={loading}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleOpen}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Opening..." : "Open Shift"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-[2] overflow-y-auto p-6">
          <CashCounter value={cashInDrawer} onChange={setCashInDrawer} />
        </div>

        <div className="flex-1 border-l border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <label className="text-sm font-medium">Note</label>
            <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[60px] whitespace-pre-wrap">
              {note || <span className="text-gray-400">Tap to type...</span>}
            </div>
          </div>
          <div className="flex-1 p-4">
            <OnScreenKeyboard
              value={note}
              onChange={setNote}
              initialLayout="english"
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

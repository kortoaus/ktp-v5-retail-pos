import { useCallback, useState } from "react";
import { createCashIO } from "../../service/cashio.service";
import OnScreenKeyboard from "../OnScreenKeyboard";
import { cn } from "../../libs/cn";
import { kickDrawer } from "../../libs/printer/kick-drawer";

interface CashIOFormProps {
  onSave: () => void;
  onCancel: () => void;
}

type CashIOType = "in" | "out";
type ActiveField = "amount" | "note";

export default function CashIOForm({ onSave, onCancel }: CashIOFormProps) {
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<CashIOType>("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("amount");
  const [kicking, setKicking] = useState(false);

  const handleKeyboardChange = (newValue: string) => {
    if (activeField === "amount") {
      if (/^[0-9]*\.?[0-9]{0,2}$/.test(newValue)) {
        setAmount(newValue);
      }
    } else {
      setNote(newValue);
    }
  };

  const keyboardValue = activeField === "amount" ? amount : note;

  const onSubmit = async () => {
    const parsed = parseFloat(amount);
    if (!amount.trim() || isNaN(parsed) || parsed <= 0) {
      window.alert("Enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      const { ok, msg } = await createCashIO({
        type,
        amount: parsed,
        note: note.trim() || undefined,
      });
      if (ok) {
        onSave();
      } else {
        window.alert(msg || "Failed to create cash record");
      }
    } catch (err) {
      console.error(err);
      window.alert("Failed to create cash record");
    } finally {
      setLoading(false);
    }
  };

  const onKickDrawer = useCallback(async () => {
    setKicking(true);
    try {
      await kickDrawer();
    } catch (err) {
      console.error(err);
      window.alert("Failed to open cash drawer");
    } finally {
      setKicking(false);
    }
  }, []);

  const inputClass = (field: ActiveField) =>
    cn(
      "w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50 disabled:bg-gray-100",
      activeField === field
        ? "border-blue-500 ring-1 ring-blue-500"
        : "border-gray-300",
    );

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Cash In / Out</h2>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onKickDrawer}
              disabled={loading || kicking}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {kicking ? "Opening..." : "Kick Drawer"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving..." : "Submit"}
            </button>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType("in")}
                disabled={loading}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                  type === "in"
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                )}
              >
                Cash In
              </button>
              <button
                type="button"
                onClick={() => setType("out")}
                disabled={loading}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                  type === "out"
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                )}
              >
                Cash Out
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium">Amount ($)</label>
            <input
              type="text"
              placeholder="0.00"
              readOnly
              value={amount}
              onPointerDown={() => setActiveField("amount")}
              disabled={loading}
              className={inputClass("amount")}
            />
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium">Note</label>
            <input
              type="text"
              placeholder="Optional note"
              readOnly
              value={note}
              onPointerDown={() => setActiveField("note")}
              disabled={loading}
              className={inputClass("note")}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex flex-col">
        <div className={cn(activeField === "amount" ? "flex-1" : "hidden")}>
          <OnScreenKeyboard
            value={keyboardValue}
            onChange={handleKeyboardChange}
            initialLayout="numpad"
            className="flex-1"
          />
        </div>
        <div className={cn(activeField === "note" ? "flex-1" : "hidden")}>
          <OnScreenKeyboard
            value={keyboardValue}
            onChange={handleKeyboardChange}
            initialLayout="korean"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}

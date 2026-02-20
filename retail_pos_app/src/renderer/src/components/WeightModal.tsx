import { useCallback, useEffect, useState } from "react";
import { QTY_DP } from "../libs/constants";

interface WeightResult {
  weight: number;
  unit: "kg" | "lb" | "oz" | "g";
  status: "stable" | "unstable" | "error" | "disconnected";
  message?: string;
}

interface WeightModalProps {
  open: boolean;
  itemName: string;
  readWeight: () => Promise<WeightResult>;
  onConfirm: (weightKg: number) => void;
  onClose: () => void;
  allowZero?: boolean;
}

export default function WeightModal({
  open,
  itemName,
  readWeight,
  onConfirm,
  onClose,
  allowZero = false,
}: WeightModalProps) {
  const [weight, setWeight] = useState<WeightResult | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!open) {
      setWeight(null);
      setReading(false);
    }
  }, [open]);

  const handleRead = useCallback(async () => {
    setReading(true);
    try {
      const result = await readWeight();
      setWeight(result);
    } catch {
      setWeight({
        weight: 0,
        unit: "kg",
        status: "error",
        message: "Read failed",
      });
    } finally {
      setReading(false);
    }
  }, [readWeight]);

  const handleConfirm = useCallback(() => {
    if (allowZero) {
      onConfirm(weight?.weight ?? 0);
      return;
    }
    if (!weight || weight.weight <= 0) return;
    onConfirm(weight.weight);
  }, [weight, allowZero, onConfirm]);

  if (!open) return null;

  const isStable = weight?.status === "stable";
  const hasWeight = weight != null && weight.weight > 0;
  const canConfirm = allowZero || (hasWeight && isStable);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-bold">Read Weight</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="text-base font-medium mb-4 truncate">{itemName}</div>

          <div className="bg-gray-50 rounded-xl p-6 text-center mb-4">
            <div className="text-5xl font-bold tabular-nums">
              {weight ? weight.weight.toFixed(QTY_DP) : "—.———"}
            </div>
            <div className="text-lg text-gray-500 mt-1">
              {weight?.unit ?? "kg"}
            </div>
            {weight && (
              <div
                className={`text-sm mt-2 font-medium ${
                  isStable ? "text-green-600" : "text-amber-600"
                }`}
              >
                {weight.status === "stable" && "Stable"}
                {weight.status === "unstable" && "Unstable — wait or re-read"}
                {weight.status === "error" && (weight.message ?? "Error")}
                {weight.status === "disconnected" && "Scale disconnected"}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onPointerDown={handleRead}
              disabled={reading}
              className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 disabled:opacity-50 font-medium text-base"
            >
              {reading ? "Reading..." : weight ? "Re-read" : "Read Scale"}
            </button>
            <button
              type="button"
              onPointerDown={handleConfirm}
              disabled={!canConfirm}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

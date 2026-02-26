import { useState } from "react";
import Numpad from "./Numpads/Numpad";
import { cn } from "../libs/cn";
import { MONEY_DP } from "../libs/constants";

import { kickDrawer } from "../libs/printer/kick-drawer";

const DENOMINATIONS = [
  { label: "$100", value: 100 },
  { label: "$50", value: 50 },
  { label: "$20", value: 20 },
  { label: "$10", value: 10 },
  { label: "$5", value: 5 },
  { label: "$2", value: 2 },
  { label: "$1", value: 1 },
  { label: "50c", value: 0.5 },
  { label: "20c", value: 0.2 },
  { label: "10c", value: 0.1 },
  { label: "5c", value: 0.05 },
];

const formatDollar = (v: number) => `$${v.toFixed(MONEY_DP)}`;

interface CashCounterProps {
  value: number;
  onChange: (dollars: number) => void;
}

export default function CashCounter({ value, onChange }: CashCounterProps) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number>(100);
  const [numpadVal, setNumpadVal] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const handleDenominationClick = (denomValue: number) => {
    if (selected === denomValue) return;
    setSelected(denomValue);
    setNumpadVal(counts[denomValue]?.toString() || "");
  };

  const handleNumpadChange = (newVal: string) => {
    if (selected === null) return;

    const count = parseInt(newVal, 10) || 0;
    if (count > 999) return;

    setNumpadVal(newVal);
    const newCounts = { ...counts, [selected]: count };
    setCounts(newCounts);

    const total = DENOMINATIONS.reduce((sum, d) => {
      return sum + (newCounts[d.value] || 0) * d.value;
    }, 0);
    onChange(Math.round(total * 100) / 100);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setCounts({});
    setSelected(100);
    setNumpadVal("");
    setConfirmReset(false);
    onChange(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-3xl font-bold">Cash Count</h2>
        <button
          onClick={() => kickDrawer()}
          className="rounded-lg bg-orange-100 px-4 py-2 text-sm font-medium text-orange-800 hover:bg-orange-200 transition-colors"
        >
          Kick Drawer
        </button>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-4">
            {DENOMINATIONS.map((d) => {
              const count = counts[d.value] || 0;
              const isSelected = selected === d.value;
              return (
                <button
                  key={d.value}
                  onClick={() => handleDenominationClick(d.value)}
                  className={cn(
                    "h-16 rounded-lg font-medium transition-colors",
                    isSelected
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                  )}
                >
                  <div className="flex items-center gap-2 w-full px-3">
                    <div className="text-xl font-bold text-right flex-1">
                      {d.label}
                    </div>
                    <div className="text-sm flex-1">X</div>
                    <div className="opacity-80 text-xl text-left flex-1">
                      {count || "None"}
                    </div>
                    <div className="text-sm flex-1">=</div>
                    <div className="text-sm flex-1">
                      {formatDollar(d.value * count)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-[300px] flex flex-col gap-4">
          <Numpad val={numpadVal} setVal={handleNumpadChange} useDot={false} />

          <div className="flex justify-between items-center p-4 bg-gray-100 rounded-lg">
            <span className="text-base font-medium">Total</span>
            <span className="text-xl font-bold">{formatDollar(value)}</span>
          </div>

          <button
            onClick={handleReset}
            className={cn(
              "w-full rounded-lg px-4 py-3 text-sm font-medium transition-colors",
              confirmReset
                ? "bg-red-100 text-red-800 hover:bg-red-200"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              value > 0 ? "opacity-100" : "opacity-0",
            )}
          >
            {confirmReset ? "Tap again to confirm reset" : "Reset"}
          </button>
        </div>
      </div>
    </div>
  );
}

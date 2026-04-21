import { useMemo } from "react";
import { useNewSalesStore } from "../../store/newSalesStore";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

export default function DocumentMonitor({}: {}) {
  const lines = useNewSalesStore(
    (s) => s.carts[s.activeCartIndex]?.lines ?? [],
  );

  const { itemCount, lineCount, qtyCount, total, tax_amount, subtotal } =
    useMemo(() => {
      const itemCount = [...new Set(lines.map((l) => l.itemId))].length;
      const lineCount = lines.length;
      const qtyCount = lines.reduce((acc, l) => {
        if (l.type === "weight" || l.type === "weight-prepacked")
          return acc + 1;
        return acc + l.qty / QTY_SCALE;
      }, 0);
      const total = lines.reduce((acc, l) => acc + l.total, 0);
      const tax_amount = lines.reduce((acc, l) => acc + l.tax_amount, 0);
      const subtotal = lines.reduce((acc, l) => acc + l.subtotal, 0);
      return { itemCount, lineCount, qtyCount, total, tax_amount, subtotal };
    }, [lines]);

  const due = total;

  return (
    <div className="grid grid-cols-12 grid-rows-2 bg-zinc-900 h-full px-4 py-2 gap-x-2">
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">ITEMS</div>
        <div className="text-white font-semibold text-base">{itemCount}</div>
      </div>
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">LINES</div>
        <div className="text-white font-semibold text-base">{lineCount}</div>
      </div>
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">QTY</div>
        <div className="text-white font-semibold text-base">
          {Math.round(qtyCount)}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">SUBTOTAL</div>
        <div className="text-white font-semibold text-base">
          {fmtMoney(subtotal)}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">TAX</div>
        <div className="text-white font-semibold text-base">
          {fmtMoney(tax_amount)}
        </div>
      </div>

      <div className="col-span-5 row-span-2 flex items-center justify-between gap-4">
        <div className="text-lg text-white font-medium">DUE</div>
        <div className="text-green-400 text-3xl font-bold">
          ${fmtMoney(due)}
        </div>
      </div>
    </div>
  );
}

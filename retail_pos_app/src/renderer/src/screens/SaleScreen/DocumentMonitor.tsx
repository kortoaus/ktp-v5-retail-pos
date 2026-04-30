import { useMemo } from "react";
import { useSalesStore } from "../../store/SalesStore";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

export default function DocumentMonitor({}: {}) {
  const lines = useSalesStore((s) => s.carts[s.activeCartIndex]?.lines ?? []);

  const { itemCount, lineCount, qtyCount, total, tax_amount, net } =
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
      const net = lines.reduce((acc, l) => acc + l.net, 0);
      return { itemCount, lineCount, qtyCount, total, tax_amount, net };
    }, [lines]);

  const due = total;

  return (
    <div className="grid grid-cols-12 grid-rows-1 bg-zinc-900 h-full px-4 py-2 gap-x-2">
      <DocumentMonitorItem label="ITEMS" value={itemCount.toString()} />
      <DocumentMonitorItem label="LINES" value={lineCount.toString()} />
      <DocumentMonitorItem
        label="QTY"
        value={Math.round(qtyCount).toString()}
      />
      <DocumentMonitorItem label="NET" value={fmtMoney(net)} colSpan={2} />
      <DocumentMonitorItem
        label="TAX"
        value={fmtMoney(tax_amount)}
        colSpan={2}
      />

      <div className="col-span-5 row-span-2 flex items-center justify-between gap-4">
        <div className="text-base text-white font-medium">DUE</div>
        <div className="text-green-400 text-2xl font-bold">
          ${fmtMoney(due)}
        </div>
      </div>
    </div>
  );
}

function DocumentMonitorItem({
  label,
  value,
  colSpan = 1,
}: {
  label: string;
  value: string;
  colSpan?: number;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center",
        colSpan && `col-span-${colSpan}`,
      )}
    >
      <div style={{ fontSize: 10 }} className="text-gray-400 font-medium">
        {label}
      </div>
      <div className="text-white font-semibold text-base">{value}</div>
    </div>
  );
}

import { type CSSProperties, useMemo } from "react";
import { useSalesStore } from "../../store/SalesStore";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

type DocumentMonitorDisplayMode = "cashier" | "customer";

type DocumentMonitorClassSet = {
  root: string;
  itemLabel: string;
  itemLabelStyle?: CSSProperties;
  itemValue: string;
  dueRoot: string;
  dueLabel: string;
  dueValue: string;
};

const DOCUMENT_MONITOR_CLASSES: Record<
  DocumentMonitorDisplayMode,
  DocumentMonitorClassSet
> = {
  cashier: {
    root: "grid grid-cols-12 grid-rows-1 bg-zinc-900 h-full px-4 py-2 gap-x-2",
    itemLabel: "text-gray-400 font-medium",
    itemLabelStyle: { fontSize: 10 },
    itemValue: "text-white font-semibold text-base",
    dueRoot: "col-span-5 row-span-2 flex items-center justify-between gap-4",
    dueLabel: "text-base text-white font-medium",
    dueValue: "text-green-400 text-2xl font-bold",
  },
  customer: {
    root: "grid grid-cols-12 bg-zinc-900 h-full px-6 py-4 gap-x-5",
    itemLabel: "text-gray-400 font-semibold text-sm",
    itemLabelStyle: undefined,
    itemValue: "text-white font-bold text-2xl leading-tight",
    dueRoot: "col-span-5 flex items-center justify-between gap-5",
    dueLabel: "text-2xl text-white font-semibold",
    dueValue: "text-green-400 text-5xl font-bold leading-none",
  },
};

const MONITOR_COL_SPAN_CLASS: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
};

export default function DocumentMonitor({
  displayMode = "cashier",
}: {
  displayMode?: DocumentMonitorDisplayMode;
}) {
  const classes = DOCUMENT_MONITOR_CLASSES[displayMode];
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
    <div className={classes.root}>
      <DocumentMonitorItem
        label="ITEMS"
        value={itemCount.toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="LINES"
        value={lineCount.toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="QTY"
        value={Math.round(qtyCount).toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="NET"
        value={fmtMoney(net)}
        colSpan={2}
        classes={classes}
      />
      <DocumentMonitorItem
        label="TAX"
        value={fmtMoney(tax_amount)}
        colSpan={2}
        classes={classes}
      />

      <div className={classes.dueRoot}>
        <div className={classes.dueLabel}>DUE</div>
        <div className={classes.dueValue}>${fmtMoney(due)}</div>
      </div>
    </div>
  );
}

function DocumentMonitorItem({
  label,
  value,
  colSpan = 1,
  classes,
}: {
  label: string;
  value: string;
  colSpan?: 1 | 2;
  classes: DocumentMonitorClassSet;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center",
        MONITOR_COL_SPAN_CLASS[colSpan],
      )}
    >
      <div style={classes.itemLabelStyle} className={classes.itemLabel}>
        {label}
      </div>
      <div className={classes.itemValue}>{value}</div>
    </div>
  );
}

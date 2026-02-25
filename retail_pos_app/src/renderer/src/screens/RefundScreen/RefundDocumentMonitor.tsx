import { useMemo } from "react";
import Decimal from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { ClientRefundableRow } from "./refund.types";

export default function RefundDocumentMonitor({
  rows,
  onRefund,
}: {
  rows: ClientRefundableRow[];
  onRefund: () => void;
}) {
  const { itemCount, qtyCount, subtotal, gst, total } = useMemo(() => {
    let qtyCount = new Decimal(0);
    let subtotal = new Decimal(0);
    let gst = new Decimal(0);

    for (const row of rows) {
      qtyCount = qtyCount.add(row.applyQty);
      subtotal = subtotal.add(row.total);
      gst = gst.add(row.tax_amount_included);
    }

    return {
      itemCount: rows.length,
      qtyCount: qtyCount.toNumber(),
      subtotal,
      gst,
      total: subtotal,
    };
  }, [rows]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <MonitorCell label="ITEMS" value={String(itemCount)} />
          <MonitorCell label="QTY" value={String(qtyCount)} />
        </div>
        <MonitorCell
          label="SUBTOTAL"
          value={`$${subtotal.toFixed(MONEY_DP)}`}
        />
        <MonitorCell label="GST INCL." value={`$${gst.toFixed(MONEY_DP)}`} />
        <div className="flex-1" />
        <div className="bg-zinc-900 rounded-xl p-4 flex items-center justify-between">
          <span className="text-white text-lg font-medium">REFUND</span>
          <span className="text-red-400 text-3xl font-bold">
            ${total.toFixed(MONEY_DP)}
          </span>
        </div>
      </div>

      <div className="p-4 border-t border-gray-200">
        <button
          type="button"
          disabled={rows.length === 0}
          onPointerDown={onRefund}
          className={
            rows.length > 0
              ? "w-full h-14 rounded-xl text-lg font-bold bg-red-600 text-white active:bg-red-700"
              : "w-full h-14 rounded-xl text-lg font-bold bg-gray-200 text-gray-400 cursor-not-allowed"
          }
        >
          Process Refund
        </button>
      </div>
    </div>
  );
}

function MonitorCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[10px] text-gray-400 font-medium">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

import Decimal from "decimal.js";
import { RefundableRow } from "../../types/models";
import { cn } from "../../libs/cn";
import { fmt } from "./refund.types";

export default function RefundableRowCard({
  row,
  index,
  onClick,
  appliedQty,
}: {
  row: RefundableRow;
  index: number;
  onClick: () => void;
  appliedQty: number;
}) {
  let qtyStr = `${row.remainingQty}/${row.qty}`;
  if (row.type === "weight-prepacked") {
    qtyStr = row.remainingQty === row.qty ? "1/1" : "0/1";
  }

  const unitPrice = new Decimal(row.total).div(new Decimal(row.qty));

  return (
    <div
      onPointerDown={() => onClick()}
      className={cn(
        "flex h-full divide-x divide-gray-200 cursor-pointer text-xs",
        row.refunded && "opacity-40",
        appliedQty > 0 && "bg-green-500 text-white",
      )}
    >
      <div className="w-10 center">{index + 1}</div>
      <div className="flex-1 flex flex-col justify-center px-2 min-w-0">
        <div className="truncate font-medium">{row.name_en}</div>
        <div className="text-[10px] text-gray-400 truncate">{row.barcode}</div>
      </div>
      <div className="w-20 center">{fmt(unitPrice)}</div>
      <div className="w-14 center">{qtyStr}</div>
      <div className="w-20 center flex flex-col">
        <span className="font-medium">{fmt(new Decimal(row.total))}</span>
        <span className="text-[10px] text-gray-400">
          GST {fmt(new Decimal(row.tax_amount_included))}
        </span>
      </div>
    </div>
  );
}

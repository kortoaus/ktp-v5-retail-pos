import Decimal from "decimal.js";
import { cn } from "../../libs/cn";
import { ClientRefundableRow, fmt } from "./refund.types";

export default function RefundedRowCard({
  row,
  index,
  onClick,
}: {
  row: ClientRefundableRow;
  index: number;
  onClick: () => void;
}) {
  return (
    <div
      onPointerDown={() => onClick()}
      className={cn(
        "flex h-full divide-x divide-gray-200 cursor-pointer text-xs",
      )}
    >
      <div className="w-10 center">{index + 1}</div>
      <div className="flex-1 flex flex-col justify-center px-2 min-w-0">
        <div className="truncate font-medium">{row.name_en}</div>
        <div className="text-[10px] text-gray-400 truncate">{row.barcode}</div>
      </div>
      <div className="w-14 center">{row.applyQty}</div>
      <div className="w-20 center flex flex-col">
        <span className="font-medium">{fmt(new Decimal(row.total))}</span>
        <span className="text-[10px] text-gray-400">
          GST {fmt(new Decimal(row.tax_amount_included))}
        </span>
      </div>
    </div>
  );
}

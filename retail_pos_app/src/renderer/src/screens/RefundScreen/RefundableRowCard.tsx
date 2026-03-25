import { RefundableRow } from "../../types/models";
import { QTY_SCALE } from "../../libs/constants";
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
  let qtyStr = `${row.remainingQty / QTY_SCALE}/${row.qty / QTY_SCALE}`;
  if (row.type === "weight-prepacked") {
    qtyStr = row.remainingQty === row.qty ? "1/1" : "0/1";
  }

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
        <div className="text-xs font-medium line-clamp-2">{row.name_en}</div>
        <div className="text-[10px] text-gray-400 truncate">{row.barcode}</div>
      </div>
      <div className="w-20 center">
        {fmt(row.discount_amount > 0
          ? Math.round((row.total - row.discount_amount) * QTY_SCALE / row.qty)
          : row.unit_price_effective)}
      </div>
      <div className="w-14 center">{qtyStr}</div>
      <div className="w-20 center flex flex-col">
        <span className="font-medium">{fmt(row.total - row.discount_amount)}</span>
        {row.discount_amount > 0 && (
          <span className="text-[10px] text-red-400 line-through">
            {fmt(row.total)}
          </span>
        )}
        <span className="text-[10px] text-gray-400">
          GST {fmt(row.tax_amount_included)}
        </span>
      </div>
    </div>
  );
}

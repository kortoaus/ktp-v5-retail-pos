import { useCartTotals } from "../../store/salesStore";
import { MONEY_DP } from "../../libs/constants";

export default function DocumentMonitor() {
  const { itemCount, lineCount, qtyCount, total, tax_amount, subtotal } =
    useCartTotals();

  return (
    <div className="grid grid-cols-12 gap-2 bg-zinc-900 h-full px-4 py-2">
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">ITEMS</div>
        <div className="flex items-center text-white font-semibold text-base">
          {itemCount}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">LINES</div>
        <div className="flex items-center text-white font-semibold text-base">
          {lineCount}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1">
        <div className="text-xs text-gray-400 font-medium">QTY</div>
        <div className="flex items-center text-white font-semibold text-base">
          {qtyCount}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">SUBTOTAL</div>
        <div className="flex items-center text-white font-semibold text-base">
          {subtotal.toFixed(MONEY_DP)}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">TAX</div>
        <div className="flex items-center text-white font-semibold text-base">
          {tax_amount.toFixed(MONEY_DP)}
        </div>
      </div>
      <div className="col-span-5 flex items-center justify-between gap-4">
        <div className="text-lg text-white font-medium">Total</div>
        <div className="text-green-400 text-3xl font-bold">
          ${total.toFixed(MONEY_DP)}
        </div>
      </div>
    </div>
  );
}

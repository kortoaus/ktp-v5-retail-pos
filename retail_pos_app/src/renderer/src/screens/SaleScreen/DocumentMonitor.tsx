import { useCartTotals } from "../../store/salesStore";
import { MONEY_DP } from "../../libs/constants";
import { useMemo } from "react";
import { Decimal } from "decimal.js";

export default function DocumentMonitor() {
  const {
    itemCount,
    lineCount,
    qtyCount,
    total,
    tax_amount,
    subtotal,
    discounts,
  } = useCartTotals();

  const promoSum = useMemo(() => {
    return discounts
      .filter((d) => !d.entityType.includes("voucher"))
      .reduce((acc, d) => acc.add(new Decimal(d.amount)), new Decimal(0))
      .toDecimalPlaces(MONEY_DP)
      .toNumber();
  }, [discounts]);

  const due = useMemo(() => {
    return new Decimal(total)
      .sub(promoSum)
      .toDecimalPlaces(MONEY_DP)
      .toNumber();
  }, [total, promoSum]);

  return (
    <div className="grid grid-cols-12 grid-rows-2 bg-zinc-900 h-full px-4 py-2 gap-x-2">
      {/* Row 1: stats */}
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
        <div className="text-white font-semibold text-base">{qtyCount}</div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">SUBTOTAL</div>
        <div className="text-white font-semibold text-base">
          {subtotal.toFixed(MONEY_DP)}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 col-span-2">
        <div className="text-xs text-gray-400 font-medium">TAX</div>
        <div className="text-white font-semibold text-base">
          {tax_amount.toFixed(MONEY_DP)}
        </div>
      </div>

      {/* DUE: spans both rows, cols 8-12 */}
      <div className="col-span-5 row-span-2 flex items-center justify-between gap-4">
        <div className="text-lg text-white font-medium">DUE</div>
        <div className="text-green-400 text-3xl font-bold">
          ${due.toFixed(MONEY_DP)}
        </div>
      </div>

      {/* Row 2: promo discount */}
      <div className="col-span-7 flex items-center gap-4">
        <div className="text-xs text-gray-400 font-medium">DISCOUNT ({discounts.length})</div>
        <div className="text-yellow-400 font-semibold text-sm">
          {promoSum > 0 ? `-$${promoSum.toFixed(MONEY_DP)}` : "$0.00"}
        </div>
      </div>
    </div>
  );
}

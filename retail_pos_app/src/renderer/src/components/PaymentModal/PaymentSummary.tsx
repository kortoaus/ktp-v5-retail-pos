import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { SummaryRow } from "./PaymentParts";

const fmt = (d: Decimal) => `$${d.toFixed(MONEY_DP)}`;

interface PaymentSummaryProps {
  subTotal: Decimal;
  lineDiscountAmount: Decimal;
  documentDiscountAmount: Decimal;
  documentDiscountMethod: "percent" | "amount";
  documentDiscountValue: number;
  totalSurcharge: Decimal;
  rounding: Decimal;
  roundedDue: Decimal;
  effectiveDue: Decimal;
  totalCash: Decimal;
  totalCredit: Decimal;
  taxAmount: Decimal;
  totalDiscountAmount: Decimal;
  totalEftpos: Decimal;
  isOverpaid: boolean;
  changeAmount: Decimal;
  canPay: boolean;
  onPay: () => void;
  CREDIT_SURCHARGE_RATE: number;
}

export default function PaymentSummary({
  subTotal,
  lineDiscountAmount,
  documentDiscountAmount,
  documentDiscountMethod,
  documentDiscountValue,
  totalSurcharge,
  rounding,
  roundedDue,
  effectiveDue,
  totalCash,
  totalCredit,
  taxAmount,
  totalDiscountAmount,
  totalEftpos,
  isOverpaid,
  changeAmount,
  canPay,
  onPay,
  CREDIT_SURCHARGE_RATE,
}: PaymentSummaryProps) {
  return (
    <div className="w-[260px] flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <SummaryRow label="Subtotal" value={fmt(subTotal)} />
          {!lineDiscountAmount.isZero() && (
            <SummaryRow
              label="Line Discounts"
              value={`-${fmt(lineDiscountAmount)}`}
              className="text-red-600"
            />
          )}
          {!documentDiscountAmount.isZero() && (
            <SummaryRow
              label={`Discount (${documentDiscountMethod === "percent" ? `${documentDiscountValue}%` : "flat"})`}
              value={`-${fmt(documentDiscountAmount)}`}
              className="text-red-600"
            />
          )}
          {!totalSurcharge.isZero() && (
            <SummaryRow
              label={`Card Surcharge (${CREDIT_SURCHARGE_RATE * 100}%)`}
              value={`+${fmt(totalSurcharge)}`}
            />
          )}
          {!rounding.isZero() && (
            <SummaryRow
              label="Rounding"
              value={`${rounding.gt(0) ? "+" : ""}${fmt(rounding)}`}
            />
          )}

          <div className="border-t border-gray-300 pt-3 flex flex-col gap-2">
            <SummaryRow label="Total" value={fmt(effectiveDue)} bold />
            <SummaryRow
              label="Cash Total"
              value={fmt(roundedDue)}
              className="text-gray-500"
            />
          </div>

          <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
            <SummaryRow label="Cash" value={fmt(totalCash)} />
            <SummaryRow label="Credit" value={fmt(totalCredit)} />
          </div>

          <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
            <SummaryRow label="GST Included" value={fmt(taxAmount)} />
            {!totalDiscountAmount.isZero() && (
              <SummaryRow
                label="You Saved"
                value={fmt(totalDiscountAmount)}
                className="text-green-600"
              />
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-200 flex flex-col gap-3">
        {totalCredit.gt(0) && (
          <div className="flex justify-between items-center text-lg font-bold text-blue-700">
            <span>EFTPOS Total</span>
            <span className="font-mono">{fmt(totalEftpos)}</span>
          </div>
        )}
        {isOverpaid && (
          <div className="flex justify-between items-center text-lg font-bold text-green-600">
            <span>Change</span>
            <span className="font-mono">
              {fmt(Decimal.min(changeAmount, totalCash))}
            </span>
          </div>
        )}
        <button
          type="button"
          disabled={!canPay}
          onPointerDown={onPay}
          className={cn(
            "w-full h-14 rounded-xl text-lg font-bold transition-colors",
            canPay
              ? "bg-blue-600 text-white active:bg-blue-700"
              : "bg-gray-200 text-gray-400 cursor-not-allowed",
          )}
        >
          Pay {fmt(effectiveDue)}
        </button>
      </div>
    </div>
  );
}

import { MONEY_DP, MONEY_SCALE, PCT_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { SummaryRow } from "../../components/PaymentParts";

const fmtMoney = (cents: number) =>
  `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;

interface PaymentSummaryProps {
  subTotal: number;
  lineDiscountAmount: number;
  documentDiscountAmount: number;
  documentDiscountMethod: "percent" | "amount";
  documentDiscountValue: number;
  totalSurcharge: number;
  rounding: number;
  roundedDue: number;
  effectiveDue: number;
  totalCash: number;
  totalCredit: number;
  totalVoucher: number;
  taxAmount: number;
  totalDiscountAmount: number;
  totalEftpos: number;
  isOverpaid: boolean;
  changeAmount: number;
  canPay: boolean;
  onPay: () => void;
  surchargeRate: number;
  processing: boolean;
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
  totalVoucher,
  taxAmount,
  totalDiscountAmount,
  totalEftpos,
  isOverpaid,
  changeAmount,
  canPay,
  onPay,
  surchargeRate,
  processing,
}: PaymentSummaryProps) {
  return (
    <div className="w-[350px] flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <SummaryRow
            label="Subtotal"
            value={fmtMoney(subTotal + totalDiscountAmount)}
          />
          {lineDiscountAmount > 0 && (
            <SummaryRow
              label="Line Discounts"
              value={`-${fmtMoney(lineDiscountAmount)}`}
              className="text-red-600"
            />
          )}
          {documentDiscountAmount > 0 && (
            <SummaryRow
              label={`Discount (${documentDiscountMethod === "percent" ? `${documentDiscountValue}%` : "flat"})`}
              value={`-${fmtMoney(documentDiscountAmount)}`}
              className="text-red-600"
            />
          )}
          {totalSurcharge > 0 && (
            <SummaryRow
              label={`Card Surcharge (${((surchargeRate / PCT_SCALE) * 100).toFixed(2)}%)`}
              value={`+${fmtMoney(totalSurcharge)}`}
            />
          )}
          {rounding !== 0 && (
            <SummaryRow
              label="Rounding"
              value={`${rounding > 0 ? "+" : ""}${fmtMoney(rounding)}`}
            />
          )}

          <div className="border-t border-gray-300 pt-3 flex flex-col gap-2">
            <SummaryRow
              label="Total"
              value={fmtMoney(effectiveDue + totalSurcharge)}
              bold
            />
            <SummaryRow
              label="Cash Total"
              value={fmtMoney(roundedDue)}
              className="text-gray-500"
            />
          </div>

          <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
            <SummaryRow label="Cash" value={fmtMoney(totalCash)} />
            <SummaryRow label="Credit" value={fmtMoney(totalCredit)} />
            {totalVoucher > 0 && (
              <SummaryRow label="Voucher" value={fmtMoney(totalVoucher)} />
            )}
          </div>

          <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
            <SummaryRow label="GST Included" value={fmtMoney(taxAmount)} />
            {totalDiscountAmount > 0 && (
              <SummaryRow
                label="You Saved"
                value={fmtMoney(totalDiscountAmount)}
                className="text-green-600"
              />
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-200 flex flex-col gap-3">
        {totalCredit > 0 && (
          <div className="flex justify-between items-center text-4xl font-bold text-blue-700">
            <span className="text-2xl">EFTPOS</span>
            <span className="font-mono">{fmtMoney(totalEftpos)}</span>
          </div>
        )}
        {isOverpaid && (
          <div className="flex justify-between items-center text-lg font-bold text-green-600">
            <span>Change</span>
            <span className="font-mono">
              {fmtMoney(Math.min(changeAmount, totalCash))}
            </span>
          </div>
        )}
        <button
          type="button"
          disabled={!canPay || processing}
          onPointerDown={onPay}
          className={cn(
            "w-full h-14 rounded-xl text-lg font-bold transition-colors",
            canPay
              ? "bg-blue-600 text-white active:bg-blue-700"
              : "bg-gray-200 text-gray-400 cursor-not-allowed",
          )}
        >
          Pay {fmtMoney(effectiveDue + totalSurcharge)}
        </button>
      </div>
    </div>
  );
}

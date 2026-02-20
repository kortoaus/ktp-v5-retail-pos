import { useMemo, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { OnPaymentPayload } from "../../types/models";
import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { cn } from "../../libs/cn";
import MoneyNumpad from "../Numpads/MoneyNumpad";

const CREDIT_SURCHARGE_RATE = 0.015; // 1.5%
const NOTES = [100, 50, 20, 10, 5, 2];

type NumpadTarget = "discount" | "credit" | "cash";

const fmt = (d: Decimal) => `$${d.toFixed(MONEY_DP)}`;
const r2 = (d: Decimal) => d.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);

export default function PaymentModal({
  open,
  onClose,
  lines,
  onPayment,
}: {
  open: boolean;
  onClose: () => void;
  lines: SaleLineType[];
  onPayment: (payload: OnPaymentPayload) => void;
}) {
  const [documentDiscountMethod, setDocumentDiscountMethod] = useState<
    "percent" | "amount"
  >("percent");
  const [documentDiscountValue, setDocumentDiscountValue] = useState(0);
  const [cashReceived, setCashReceived] = useState(0);
  const [creditReceived, setCreditReceived] = useState(0);

  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>("cash");
  const [numpadVal, setNumpadVal] = useState("");

  const subTotal = useMemo(() => {
    return lines.reduce((acc, line) => {
      return acc.add(new Decimal(line.total));
    }, new Decimal(0));
  }, [lines]);

  const taxableRatio = useMemo(() => {
    if (subTotal.isZero()) return new Decimal(0);
    const taxableTotal = lines
      .filter((line) => line.taxable)
      .reduce((acc, line) => {
        return acc.add(new Decimal(line.total));
      }, new Decimal(0));

    return taxableTotal.div(subTotal);
  }, [lines, subTotal]);

  const documentDiscountAmount = useMemo(() => {
    if (documentDiscountMethod === "percent") {
      const factor = new Decimal(documentDiscountValue).div(100);
      return r2(subTotal.mul(factor));
    }
    return new Decimal(documentDiscountValue);
  }, [subTotal, documentDiscountMethod, documentDiscountValue]);

  const exactDue = useMemo(
    () => subTotal.sub(documentDiscountAmount),
    [subTotal, documentDiscountAmount],
  );

  const creditSurchargeAmount = useMemo(() => {
    return r2(new Decimal(creditReceived).mul(CREDIT_SURCHARGE_RATE));
  }, [creditReceived]);

  const totalDue = useMemo(
    () => exactDue.add(creditSurchargeAmount),
    [exactDue, creditSurchargeAmount],
  );

  const roundedTotalDue = useMemo(() => {
    if (cashReceived <= 0) return totalDue;
    return totalDue.toNearest(new Decimal("0.05"), Decimal.ROUND_HALF_UP);
  }, [totalDue, cashReceived]);

  const taxAmount = useMemo(() => {
    const taxableGoods = exactDue.mul(taxableRatio);
    const taxableSurcharge = creditSurchargeAmount.mul(taxableRatio);
    return r2(taxableGoods.add(taxableSurcharge).div(11));
  }, [exactDue, taxableRatio, creditSurchargeAmount]);

  const cashRounding = useMemo(
    () => roundedTotalDue.sub(totalDue),
    [roundedTotalDue, totalDue],
  );

  const eftposAmount = useMemo(() => {
    return r2(new Decimal(creditReceived).add(creditSurchargeAmount));
  }, [creditReceived, creditSurchargeAmount]);

  const remaining = useMemo(() => {
    return roundedTotalDue.sub(new Decimal(cashReceived)).sub(eftposAmount);
  }, [roundedTotalDue, cashReceived, eftposAmount]);

  const lineDiscountAmount = useMemo(() => {
    const originalSubTotal = lines.reduce((acc, line) => {
      const originalTotal = new Decimal(line.unit_price_original).mul(line.qty);
      return acc.add(originalTotal);
    }, new Decimal(0));
    return r2(originalSubTotal.sub(subTotal));
  }, [lines, subTotal]);

  const totalDiscountAmount = useMemo(() => {
    return lineDiscountAmount.add(documentDiscountAmount);
  }, [lineDiscountAmount, documentDiscountAmount]);

  const isShort = remaining.gt(0);
  const isOverpaid = remaining.lt(0);
  const changeAmount = isOverpaid ? remaining.abs() : new Decimal(0);
  const shortAmount = isShort ? remaining : new Decimal(0);
  const canPay = !isShort;

  function handleNumpadChange(newVal: string) {
    setNumpadVal(newVal);
    const cents = parseInt(newVal || "0", 10);
    const dollars = cents / 100;

    if (numpadTarget === "cash") setCashReceived(dollars);
    else if (numpadTarget === "credit") setCreditReceived(dollars);
    else if (numpadTarget === "discount") setDocumentDiscountValue(dollars);
  }

  function switchTarget(target: NumpadTarget) {
    if (numpadTarget === target) {
      if (target === "credit" && creditReceived === 0) {
        const fill = Math.max(0, exactDue.toNumber());
        setCreditReceived(fill);
        setNumpadVal(Math.round(fill * 100).toString());
        return;
      }
      if (target === "cash" && cashReceived === 0 && remaining.gt(0)) {
        const wouldBeTotal = totalDue.toNearest(new Decimal("0.05"), Decimal.ROUND_HALF_UP);
        const fill = Decimal.max(new Decimal(0), wouldBeTotal.sub(eftposAmount));
        setCashReceived(fill.toNumber());
        setNumpadVal(Math.round(fill.toNumber() * 100).toString());
        return;
      }
      return;
    }

    setNumpadTarget(target);
    let cents = 0;
    if (target === "cash") cents = Math.round(cashReceived * 100);
    else if (target === "credit") cents = Math.round(creditReceived * 100);
    else if (target === "discount")
      cents = Math.round(documentDiscountValue * 100);
    setNumpadVal(cents > 0 ? cents.toString() : "");
  }

  function addNote(noteValue: number) {
    const newCash = cashReceived + noteValue;
    setCashReceived(newCash);
    if (numpadTarget === "cash") {
      setNumpadVal(Math.round(newCash * 100).toString());
    }
  }

  function handlePayment() {
    if (documentDiscountAmount.gt(subTotal)) {
      window.alert("Discount cannot exceed subtotal");
      return;
    }
    if (new Decimal(creditReceived).gt(exactDue)) {
      window.alert("Credit cannot exceed total due");
      return;
    }
    if (remaining.gt(0)) {
      window.alert("Payment is short");
      return;
    }

    const cashPaidD = Decimal.min(
      new Decimal(cashReceived),
      roundedTotalDue.sub(eftposAmount),
    );
    const cashPaid = Decimal.max(cashPaidD, new Decimal(0));

    onPayment({
      subtotal: subTotal.toNumber(),
      documentDiscountAmount: documentDiscountAmount.toNumber(),
      creditSurchargeAmount: creditSurchargeAmount.toNumber(),
      cashRounding: cashRounding.toNumber(),
      total: roundedTotalDue.toNumber(),
      taxAmount: taxAmount.toNumber(),
      cashPaid: cashPaid.toNumber(),
      cashChange: changeAmount.toNumber(),
      creditPaid: creditReceived,
      totalDiscountAmount: totalDiscountAmount.toNumber(),
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[95%] h-[95%]">
        {/* Status bar */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-gray-200">
          <h2 className="text-xl font-bold">Payment</h2>
          <div className="flex items-center gap-6">
            {isShort && (
              <span className="text-2xl font-bold text-red-600">
                SHORT {fmt(shortAmount)}
              </span>
            )}
            {isOverpaid && (
              <span className="text-2xl font-bold text-green-600">
                CHANGE {fmt(changeAmount)}
              </span>
            )}
            {!isShort && !isOverpaid && (
              <span className="text-2xl font-bold text-blue-600">EXACT</span>
            )}
            <button
              type="button"
              onPointerDown={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Col 1: Inputs + Numpad */}
          <div className="flex-1 flex flex-col border-r border-gray-200">
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onPointerDown={() => {
                    setDocumentDiscountMethod("percent");
                    switchTarget("discount");
                  }}
                  className={cn(
                    "h-12 rounded-xl text-base font-bold transition-colors",
                    documentDiscountMethod === "percent"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-600 active:bg-gray-300",
                  )}
                >
                  Discount %
                </button>
                <button
                  type="button"
                  onPointerDown={() => {
                    setDocumentDiscountMethod("amount");
                    switchTarget("discount");
                  }}
                  className={cn(
                    "h-12 rounded-xl text-base font-bold transition-colors",
                    documentDiscountMethod === "amount"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-600 active:bg-gray-300",
                  )}
                >
                  Discount $
                </button>
              </div>

              <InputField
                label="Discount"
                active={numpadTarget === "discount"}
                onActivate={() => switchTarget("discount")}
              >
                <span className="text-2xl font-bold font-mono">
                  {documentDiscountMethod === "percent"
                    ? `${documentDiscountValue}%`
                    : `$${documentDiscountValue.toFixed(MONEY_DP)}`}
                </span>
                {!documentDiscountAmount.isZero() && (
                  <span className="text-xs text-red-600">
                    -{fmt(documentDiscountAmount)}
                  </span>
                )}
              </InputField>

              <InputField
                label="Credit"
                active={numpadTarget === "credit"}
                onActivate={() => switchTarget("credit")}
              >
                <span className="text-2xl font-bold font-mono">
                  ${creditReceived.toFixed(MONEY_DP)}
                </span>
                {creditReceived > 0 && (
                  <span className="text-xs text-blue-700 font-medium">
                    EFTPOS: {fmt(eftposAmount)} (incl. 1.5%)
                  </span>
                )}
              </InputField>

              <InputField
                label="Cash"
                active={numpadTarget === "cash"}
                onActivate={() => switchTarget("cash")}
              >
                <span className="text-2xl font-bold font-mono">
                  ${cashReceived.toFixed(MONEY_DP)}
                </span>
              </InputField>
            </div>
          </div>

          <div className="w-[300px] p-2 flex flex-col gap-2">
            <div className="flex-1">
              <MoneyNumpad val={numpadVal} setVal={handleNumpadChange} />
            </div>
            <div className="grid grid-cols-3 gap-2 h-48">
              {NOTES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onPointerDown={() => addNote(n)}
                  className="flex-1 text-xl font-bold bg-green-50 text-green-800 active:bg-green-200 transition-colors"
                >
                  +${n}
                </button>
              ))}
            </div>
          </div>

          {/* Col 3: Summary */}
          <div className="w-[340px] flex flex-col">
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
                {!creditSurchargeAmount.isZero() && (
                  <SummaryRow
                    label="Card Surcharge (1.5%)"
                    value={`+${fmt(creditSurchargeAmount)}`}
                  />
                )}
                {!cashRounding.isZero() && (
                  <SummaryRow
                    label="Cash Rounding"
                    value={`${cashRounding.gt(0) ? "+" : ""}${fmt(cashRounding)}`}
                  />
                )}

                <div className="border-t border-gray-300 pt-3">
                  <SummaryRow label="Total" value={fmt(roundedTotalDue)} bold />
                </div>

                <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
                  <SummaryRow
                    label="Cash"
                    value={fmt(new Decimal(cashReceived))}
                  />
                  <SummaryRow
                    label="Credit"
                    value={fmt(new Decimal(creditReceived))}
                  />
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
              {creditReceived > 0 && (
                <div className="flex justify-between items-center text-lg font-bold text-blue-700">
                  <span>EFTPOS Amount</span>
                  <span className="font-mono">{fmt(eftposAmount)}</span>
                </div>
              )}
              {isOverpaid && (
                <div className="flex justify-between items-center text-lg font-bold text-green-600">
                  <span>Change</span>
                  <span className="font-mono">{fmt(changeAmount)}</span>
                </div>
              )}
              <button
                type="button"
                disabled={!canPay}
                onPointerDown={handlePayment}
                className={cn(
                  "w-full h-14 rounded-xl text-lg font-bold transition-colors",
                  canPay
                    ? "bg-blue-600 text-white active:bg-blue-700"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed",
                )}
              >
                Pay {fmt(roundedTotalDue)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputField({
  label,
  active,
  onActivate,
  children,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerDown={onActivate}
      className={cn(
        "rounded-xl p-4 flex flex-col gap-1 cursor-pointer transition-colors border-2",
        active ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white",
      )}
    >
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  className,
}: {
  label: string;
  value: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex justify-between items-center",
        bold ? "text-lg font-bold" : "text-sm",
        className,
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

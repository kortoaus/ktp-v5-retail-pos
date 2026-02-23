import { useMemo, useState } from "react";
import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { SaleLineType } from "../../types/sales";
import { OnPaymentPayload } from "../../types/models";
import MoneyNumpad from "../Numpads/MoneyNumpad";
import { Payment, usePaymentCalc } from "./usePaymentCalc";
import { InputField } from "./PaymentParts";
import PaymentSummary from "./PaymentSummary";

const NOTES = [100, 50, 20, 10, 5, 2, 1, 0.5];

type NumpadTarget = "discount" | "credit" | "cash";

const fmt = (d: Decimal) => `$${d.toFixed(MONEY_DP)}`;

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
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>("discount");
  const [numpadVal, setNumpadVal] = useState("");
  const [committedPayments, setCommittedPayments] = useState<Payment[]>([]);

  const calc = usePaymentCalc({
    lines,
    documentDiscountMethod,
    documentDiscountValue,
    committedPayments,
    stagingCash: cashReceived,
    stagingCredit: creditReceived,
  });

  const stagingCreditEftpos = useMemo(() => {
    if (creditReceived <= 0) return new Decimal(0);
    const amt = new Decimal(creditReceived);
    const sc = amt.mul(0.015).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
    return amt.add(sc);
  }, [creditReceived]);

  function handleNumpadChange(newVal: string) {
    setNumpadVal(newVal);
    const dollars = parseInt(newVal || "0", 10) / 100;

    if (numpadTarget === "cash") setCashReceived(dollars);
    else if (numpadTarget === "credit") setCreditReceived(dollars);
    else if (numpadTarget === "discount") setDocumentDiscountValue(dollars);
  }

  function switchTarget(target: NumpadTarget) {
    if (numpadTarget === target) {
      if (target === "credit" && creditReceived === 0) {
        const fill = Math.max(0, calc.remaining.toNumber());
        setCreditReceived(fill);
        setNumpadVal(Math.round(fill * 100).toString());
        return;
      }
      if (target === "cash" && cashReceived === 0 && calc.remaining.gt(0)) {
        const cashRemaining = Decimal.max(
          new Decimal(0),
          calc.roundedDue.sub(calc.totalCash).sub(calc.totalCredit),
        );
        setCashReceived(cashRemaining.toNumber());
        setNumpadVal(Math.round(cashRemaining.toNumber() * 100).toString());
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

  function addPayment() {
    const newEntries: Payment[] = [];
    if (creditReceived > 0) {
      newEntries.push({ type: "credit", amount: creditReceived });
    }
    if (cashReceived > 0) {
      newEntries.push({ type: "cash", amount: cashReceived });
    }
    if (newEntries.length === 0) return;

    setCommittedPayments((prev) => [...prev, ...newEntries]);
    setCashReceived(0);
    setCreditReceived(0);
    setNumpadVal("");
  }

  function removePayment(index: number) {
    if (!window.confirm("Remove this payment line?")) return;
    setCommittedPayments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleClose() {
    setDocumentDiscountMethod("percent");
    setDocumentDiscountValue(0);
    setCashReceived(0);
    setCreditReceived(0);
    setNumpadTarget("discount");
    setNumpadVal("");
    setCommittedPayments([]);
    onClose();
  }

  function handlePayment() {
    if (calc.documentDiscountAmount.gt(calc.subTotal)) {
      window.alert("Discount cannot exceed subtotal");
      return;
    }
    if (calc.totalCredit.gt(calc.effectiveDue)) {
      window.alert("Credit cannot exceed total");
      return;
    }
    if (calc.remaining.gt(0)) {
      window.alert("Payment is short");
      return;
    }

    const finalLines = calc.allPaymentLines;

    const cashPaid = Decimal.max(
      new Decimal(0),
      Decimal.min(calc.totalCash, calc.effectiveDue.sub(calc.totalCredit)),
    );

    onPayment({
      subtotal: calc.subTotal.toNumber(),
      documentDiscountAmount: calc.documentDiscountAmount.toNumber(),
      creditSurchargeAmount: calc.totalSurcharge.toNumber(),
      rounding: calc.effectiveRounding.toNumber(),
      total: calc.effectiveDue.toNumber(),
      taxAmount: calc.taxAmount.toNumber(),
      cashPaid: cashPaid.toNumber(),
      cashChange: calc.changeAmount.toNumber(),
      creditPaid: calc.totalCredit.toNumber(),
      totalDiscountAmount: calc.totalDiscountAmount.toNumber(),
      payments: finalLines.map((l) => ({
        type: l.type,
        amount: l.amount.toNumber(),
        surcharge: l.surcharge.toNumber(),
      })),
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[98%] h-[96%]">
        <div className="flex items-center justify-between px-6 h-12 border-b border-gray-200">
          <h2 className="text-xl font-bold">Payment</h2>
          <div className="flex items-center gap-6">
            {calc.isShort && (
              <span className="text-2xl font-bold text-red-600">
                SHORT {fmt(calc.shortAmount)}
              </span>
            )}
            {calc.isOverpaid && (
              <span className="text-2xl font-bold text-green-600">
                CHANGE {fmt(Decimal.min(calc.changeAmount, calc.totalCash))}
              </span>
            )}
            {!calc.isShort && !calc.isOverpaid && (
              <span className="text-2xl font-bold text-blue-600">EXACT</span>
            )}
            <button
              type="button"
              onPointerDown={handleClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden divide-x divide-gray-200">
          <div className="flex-1 flex flex-col">
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
                {!calc.documentDiscountAmount.isZero() && (
                  <span className="text-xs text-red-600">
                    -{fmt(calc.documentDiscountAmount)}
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
                    EFTPOS: {fmt(stagingCreditEftpos)} (incl. 1.5%)
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

              <button
                type="button"
                onPointerDown={addPayment}
                disabled={cashReceived === 0 && creditReceived === 0}
                className={cn(
                  "h-12 rounded-xl text-base font-bold transition-colors",
                  cashReceived > 0 || creditReceived > 0
                    ? "bg-amber-500 text-white active:bg-amber-600"
                    : "bg-gray-100 text-gray-300 cursor-not-allowed",
                )}
              >
                + Add Payment
              </button>
            </div>
          </div>

          <div className="w-[320px] p-2 flex flex-col gap-2">
            <div className="flex-1">
              <MoneyNumpad val={numpadVal} setVal={handleNumpadChange} />
            </div>

            {numpadTarget === "cash" && (
              <div className="h-48 grid grid-cols-4 gap-2">
                {NOTES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onPointerDown={() => {
                      addNote(n);
                      setNumpadTarget("cash");
                    }}
                    className="flex-1 text-xl font-bold bg-green-50 text-green-800 active:bg-green-200 transition-colors"
                  >
                    +${n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {committedPayments.length > 0 && (
            <div className="w-[220px] overflow-y-auto p-2 flex flex-col gap-1">
              <span className="text-xs font-bold text-gray-400 uppercase px-1">
                Payments
              </span>
              {committedPayments.map((p, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2",
                    p.type === "cash" ? "bg-green-50" : "bg-blue-50",
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-gray-500 uppercase">
                      {p.type}
                    </span>
                    <span className="text-base font-bold font-mono">
                      ${p.amount.toFixed(MONEY_DP)}
                    </span>
                    {p.type === "credit" && (
                      <span className="text-xs text-blue-700">
                        EFTPOS: {fmt(calc.allPaymentLines[i].eftpos)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onPointerDown={() => removePayment(i)}
                    className="w-8 h-8 flex items-center justify-center rounded text-red-400 active:bg-red-100 text-lg shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <PaymentSummary
            subTotal={calc.subTotal}
            lineDiscountAmount={calc.lineDiscountAmount}
            documentDiscountAmount={calc.documentDiscountAmount}
            documentDiscountMethod={documentDiscountMethod}
            documentDiscountValue={documentDiscountValue}
            totalSurcharge={calc.totalSurcharge}
            rounding={calc.effectiveRounding}
            roundedDue={calc.roundedDue}
            effectiveDue={calc.effectiveDue}
            totalCash={calc.totalCash}
            totalCredit={calc.totalCredit}
            taxAmount={calc.taxAmount}
            totalDiscountAmount={calc.totalDiscountAmount}
            totalEftpos={calc.totalEftpos}
            isOverpaid={calc.isOverpaid}
            changeAmount={calc.changeAmount}
            canPay={calc.canPay}
            onPay={handlePayment}
          />
        </div>
      </div>
    </div>
  );
}

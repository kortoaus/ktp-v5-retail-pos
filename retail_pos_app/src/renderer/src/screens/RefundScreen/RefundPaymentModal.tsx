import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { RefundableInvoice } from "../../types/models";
import {
  createRefundInvoice,
  getSaleInvoiceById,
} from "../../service/sale.service";
import { printRefundReceipt } from "../../libs/printer/refund-receipt";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import MoneyNumpad from "../../components/Numpads/MoneyNumpad";
import { InputField } from "../../components/PaymentModal/PaymentParts";
import { SummaryRow } from "../../components/PaymentModal/PaymentParts";
import { ClientRefundableRow } from "./refund.types";

const fmt = (d: Decimal) => `$${d.toFixed(MONEY_DP)}`;

type NumpadTarget = "cash" | "credit";

export default function RefundPaymentModal({
  open,
  onClose,
  onComplete,
  invoice,
  refundedRows,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  invoice: RefundableInvoice;
  refundedRows: ClientRefundableRow[];
}) {
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>("cash");
  const [numpadVal, setNumpadVal] = useState("");
  const [cashRefund, setCashRefund] = useState(0);
  const [creditRefund, setCreditRefund] = useState(0);
  const [processing, setProcessing] = useState(false);

  // Compute refund totals
  const { refundTotal, refundGst } = useMemo(() => {
    let total = new Decimal(0);
    let gst = new Decimal(0);
    for (const row of refundedRows) {
      total = total.add(row.total);
      gst = gst.add(row.tax_amount_included);
    }
    return { refundTotal: total, refundGst: gst };
  }, [refundedRows]);

  // Remaining payment caps from server (accounts for previous refunds)
  const remainingCashCap = new Decimal(invoice.remainingCash);
  const remainingCreditCap = new Decimal(invoice.remainingCredit);

  // Always 5c round — avoids moving target when cash toggles
  const roundedTotal = refundTotal.toNearest(
    new Decimal("0.05"),
    Decimal.ROUND_HALF_UP,
  );
  const effectiveTotal = roundedTotal;
  const rounding = roundedTotal.sub(refundTotal);

  // Build Decimals from cents to avoid JS float precision drift
  const cashCents = Math.round(cashRefund * 100);
  const creditCents = Math.round(creditRefund * 100);
  const cashDec = new Decimal(cashCents).div(100);
  const creditDec = new Decimal(creditCents).div(100);
  const paid = cashDec.add(creditDec);
  const remaining = effectiveTotal.sub(paid);
  const isBalanced = remaining.isZero();
  const isOver = remaining.lt(0);
  const hasCash = cashCents > 0;

  const canConfirm =
    isBalanced &&
    !processing &&
    cashDec.lte(remainingCashCap) &&
    creditDec.lte(remainingCreditCap);

  function handleNumpadChange(newVal: string) {
    setNumpadVal(newVal);
    const dollars = parseInt(newVal || "0", 10) / 100;
    if (numpadTarget === "cash") setCashRefund(dollars);
    else setCreditRefund(dollars);
  }

  function switchTarget(target: NumpadTarget) {
    if (numpadTarget === target) {
      // Double-tap: auto-fill remaining
      if (remaining.gt(0)) {
        const fill = remaining.toNumber();
        if (target === "cash") {
          setCashRefund(cashRefund + fill);
          setNumpadVal(
            Math.round((cashRefund + fill) * 100).toString(),
          );
        } else {
          setCreditRefund(creditRefund + fill);
          setNumpadVal(
            Math.round((creditRefund + fill) * 100).toString(),
          );
        }
      }
      return;
    }
    setNumpadTarget(target);
    const cents =
      target === "cash"
        ? Math.round(cashRefund * 100)
        : Math.round(creditRefund * 100);
    setNumpadVal(cents > 0 ? cents.toString() : "");
  }

  function resetState() {
    setNumpadTarget("cash");
    setNumpadVal("");
    setCashRefund(0);
    setCreditRefund(0);
    setProcessing(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setProcessing(true);

    const rows = refundedRows.map((row, i) => ({
      type: row.type,
      itemId: row.itemId,
      name_en: row.name_en,
      name_ko: row.name_ko,
      taxable: row.taxable,
      uom: row.uom,
      barcode: row.barcode,
      index: i,
      barcodePrice: row.barcodePrice,
      unit_price_original: row.unit_price_original,
      unit_price_discounted: row.unit_price_discounted,
      unit_price_adjusted: row.unit_price_adjusted,
      unit_price_effective: row.unit_price_effective,
      qty: row.applyQty,
      measured_weight: row.measured_weight,
      subtotal: row.total,
      total: row.total,
      original_invoice_id: row.original_invoice_id ?? invoice.id,
      original_invoice_row_id: row.original_invoice_row_id ?? row.id,
      adjustments: row.adjustments,
      tax_amount_included: row.tax_amount_included,
    }));

    const payments: { type: string; amount: number; surcharge: number }[] = [];
    if (cashRefund > 0)
      payments.push({ type: "cash", amount: cashRefund, surcharge: 0 });
    if (creditRefund > 0)
      payments.push({ type: "credit", amount: creditRefund, surcharge: 0 });

    const { ok, msg, result } = await createRefundInvoice({
      original_invoice_id: invoice.id,
      subtotal: refundTotal.toNumber(),
      documentDiscountAmount: 0,
      creditSurchargeAmount: 0,
      rounding: rounding.toNumber(),
      total: effectiveTotal.toNumber(),
      taxAmount: refundGst.toNumber(),
      cashPaid: cashRefund,
      cashChange: 0,
      creditPaid: creditRefund,
      totalDiscountAmount: 0,
      memberId: invoice.memberId != null ? String(invoice.memberId) : null,
      memberLevel: invoice.memberLevel,
      rows,
      payments,
    });

    if (!ok || !result) {
      window.alert(msg);
      setProcessing(false);
      return;
    }

    const { result: refundInvoice } = await getSaleInvoiceById(result.id);

    if (cashRefund > 0) {
      kickDrawer();
    }

    if (refundInvoice) {
      printRefundReceipt(refundInvoice);
    }

    resetState();
    onComplete();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[700px] h-[580px]">
        <div className="flex items-center justify-between px-6 h-12 border-b border-gray-200">
          <h2 className="text-xl font-bold">Refund Payment</h2>
          <button
            type="button"
            onPointerDown={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden divide-x divide-gray-200">
          {/* Left: inputs + summary */}
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <SummaryRow label="Refund Total" value={fmt(refundTotal)} bold />
              <SummaryRow label="GST Included" value={fmt(refundGst)} />
              {!rounding.isZero() && (
                <SummaryRow
                  label="Rounding"
                  value={`${rounding.gt(0) ? "+" : ""}${fmt(rounding)}`}
                />
              )}
              {hasCash && (
                <SummaryRow
                  label="Cash Total"
                  value={fmt(effectiveTotal)}
                  className="text-gray-500"
                />
              )}
            </div>

            <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-xs text-gray-400">
              <span>Remaining Cash Cap: {fmt(remainingCashCap)}</span>
              <span>Remaining Credit Cap: {fmt(remainingCreditCap)}</span>
            </div>

            <InputField
              label="Cash Refund"
              active={numpadTarget === "cash"}
              onActivate={() => switchTarget("cash")}
            >
              <span className="text-2xl font-bold font-mono">
                ${cashRefund.toFixed(MONEY_DP)}
              </span>
              {cashDec.gt(remainingCashCap) && (
                <span className="text-xs text-red-600">
                  Exceeds original cash
                </span>
              )}
            </InputField>

            <InputField
              label="Credit Refund"
              active={numpadTarget === "credit"}
              onActivate={() => switchTarget("credit")}
            >
              <span className="text-2xl font-bold font-mono">
                ${creditRefund.toFixed(MONEY_DP)}
              </span>
              {creditDec.gt(remainingCreditCap) && (
                <span className="text-xs text-red-600">
                  Exceeds original credit
                </span>
              )}
            </InputField>

            <div className="flex-1" />

            {remaining.gt(0) && (
              <div className="text-center text-red-600 font-bold">
                SHORT {fmt(remaining)}
              </div>
            )}
            {isOver && (
              <div className="text-center text-red-600 font-bold">
                OVER {fmt(remaining.abs())}
              </div>
            )}
            {isBalanced && (
              <div className="text-center text-green-600 font-bold">
                BALANCED
              </div>
            )}

            <button
              type="button"
              disabled={!canConfirm}
              onPointerDown={handleConfirm}
              className={cn(
                "w-full h-14 rounded-xl text-lg font-bold transition-colors",
                canConfirm
                  ? "bg-red-600 text-white active:bg-red-700"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed",
              )}
            >
              {processing ? "Processing..." : `Confirm Refund ${fmt(effectiveTotal)}`}
            </button>
          </div>

          {/* Right: numpad */}
          <div className="w-[280px] p-2 flex flex-col">
            <div className="flex-1">
              <MoneyNumpad val={numpadVal} setVal={handleNumpadChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

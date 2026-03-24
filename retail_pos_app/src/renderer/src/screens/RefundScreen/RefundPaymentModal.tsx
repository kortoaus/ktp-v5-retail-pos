import { useMemo, useState } from "react";
import { MONEY_DP, MONEY_SCALE, PCT_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { RefundableInvoice } from "../../types/models";
import {
  createRefundInvoice,
  getSaleInvoiceById,
} from "../../service/sale.service";
import { printRefundReceipt } from "../../libs/printer/refund-receipt";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import MoneyNumpad from "../../components/Numpads/MoneyNumpad";
import { InputField, SummaryRow } from "../../components/PaymentParts";
import { ClientRefundableRow, fmt } from "./refund.types";

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
  const [voucherRefunds, setVoucherRefunds] = useState<
    { entityType: string; entityId: number; amount: number }[]
  >([]);

  const availableVouchers = invoice.remainingVouchers ?? [];

  const { refundTotal, refundGst } = useMemo(() => {
    let total = 0;
    let gst = 0;
    for (const row of refundedRows) {
      total += row.total;
      gst += row.tax_amount_included;
    }
    return { refundTotal: total, refundGst: gst };
  }, [refundedRows]);

  const remainingCashCap = invoice.remainingCash;
  const remainingCreditCap = invoice.remainingCredit;

  const rem = refundTotal % 5;
  const roundedTotal = rem === 0 ? refundTotal : refundTotal + (rem >= 3 ? 5 - rem : -rem);
  const effectiveTotal = roundedTotal;
  const rounding = roundedTotal - refundTotal;

  const voucherTotal = voucherRefunds.reduce((acc, v) => acc + v.amount, 0);
  const paid = cashRefund + creditRefund + voucherTotal;
  const remaining = effectiveTotal - paid;
  const isBalanced = remaining === 0;
  const isOver = remaining < 0;

  const voucherCapsValid = voucherRefunds.every((vr) => {
    const cap = availableVouchers.find(
      (v) => v.entityId === vr.entityId && v.entityType === vr.entityType,
    );
    return cap && vr.amount <= cap.remainingAmount;
  });

  const canConfirm =
    isBalanced &&
    !processing &&
    cashRefund <= remainingCashCap &&
    creditRefund <= remainingCreditCap &&
    voucherCapsValid;

  function handleNumpadChange(newVal: string) {
    setNumpadVal(newVal);
    const cents = parseInt(newVal || "0", 10);
    if (numpadTarget === "cash") setCashRefund(cents);
    else setCreditRefund(cents);
  }

  function switchTarget(target: NumpadTarget) {
    if (numpadTarget === target) {
      if (remaining > 0) {
        const fill = remaining;
        if (target === "cash") {
          setCashRefund(cashRefund + fill);
          setNumpadVal((cashRefund + fill).toString());
        } else {
          setCreditRefund(creditRefund + fill);
          setNumpadVal((creditRefund + fill).toString());
        }
      }
      return;
    }
    setNumpadTarget(target);
    const val = target === "cash" ? cashRefund : creditRefund;
    setNumpadVal(val > 0 ? val.toString() : "");
  }

  function toggleVoucher(entityType: string, entityId: number) {
    const exists = voucherRefunds.find(
      (v) => v.entityId === entityId && v.entityType === entityType,
    );
    if (exists) {
      setVoucherRefunds((prev) =>
        prev.filter(
          (v) => !(v.entityId === entityId && v.entityType === entityType),
        ),
      );
      return;
    }
    const cap = availableVouchers.find(
      (v) => v.entityId === entityId && v.entityType === entityType,
    );
    if (!cap || cap.remainingAmount <= 0) return;
    const fill = Math.min(cap.remainingAmount, Math.max(0, remaining));
    setVoucherRefunds((prev) => [
      ...prev,
      { entityType, entityId, amount: fill },
    ]);
  }

  function resetState() {
    setNumpadTarget("cash");
    setNumpadVal("");
    setCashRefund(0);
    setCreditRefund(0);
    setVoucherRefunds([]);
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
      subtotal: row.total - row.tax_amount_included,
      total: row.total,
      original_invoice_id: row.original_invoice_id ?? invoice.id,
      original_invoice_row_id: row.original_invoice_row_id ?? row.id,
      adjustments: row.adjustments,
      tax_amount_included: row.tax_amount_included,
    }));

    const payments: {
      type: string;
      amount: number;
      surcharge: number;
      entityType?: string;
      entityId?: number;
    }[] = [];
    if (cashRefund > 0)
      payments.push({ type: "cash", amount: cashRefund, surcharge: 0 });
    if (creditRefund > 0)
      payments.push({ type: "credit", amount: creditRefund, surcharge: 0 });
    for (const vr of voucherRefunds) {
      if (vr.amount > 0) {
        payments.push({
          type: "voucher",
          amount: vr.amount,
          surcharge: 0,
          entityType: vr.entityType,
          entityId: vr.entityId,
        });
      }
    }

    const { ok, msg, result } = await createRefundInvoice({
      original_invoice_id: invoice.id,
      subtotal: refundTotal,
      documentDiscountAmount: 0,
      creditSurchargeAmount: 0,
      rounding,
      total: effectiveTotal,
      taxAmount: refundGst,
      cashPaid: cashRefund,
      cashChange: 0,
      creditPaid: creditRefund,
      voucherPaid: voucherTotal,
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

    if (cashRefund > 0) kickDrawer();
    if (refundInvoice) printRefundReceipt(refundInvoice);

    resetState();
    onComplete();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[780px] h-[620px]">
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
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <SummaryRow label="Refund Total" value={fmt(refundTotal)} bold />
              <SummaryRow label="GST Included" value={fmt(refundGst)} />
              {rounding !== 0 && (
                <SummaryRow
                  label="Rounding"
                  value={`${rounding > 0 ? "+" : ""}${fmt(rounding)}`}
                />
              )}
              {cashRefund > 0 && (
                <SummaryRow
                  label="Cash Total"
                  value={fmt(effectiveTotal)}
                  className="text-gray-500"
                />
              )}
            </div>

            <div className="border-t border-gray-200 pt-3 flex flex-col gap-1 text-base font-bold text-red-400">
              <span>Remaining Cash Cap: {fmt(remainingCashCap)}</span>
              <span>Remaining Credit Cap: {fmt(remainingCreditCap)}</span>
              {availableVouchers.length > 0 && (
                <span>
                  Remaining Voucher Cap: {fmt(invoice.remainingVoucher ?? 0)}
                </span>
              )}
            </div>

            <InputField
              label="Cash Refund"
              active={numpadTarget === "cash"}
              onActivate={() => switchTarget("cash")}
            >
              <span className="text-2xl font-bold font-mono">
                {fmt(cashRefund)}
              </span>
              {cashRefund > remainingCashCap && (
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
                {fmt(creditRefund)}
              </span>
              {creditRefund > remainingCreditCap && (
                <span className="text-xs text-red-600">
                  Exceeds original credit
                </span>
              )}
            </InputField>

            {availableVouchers.length > 0 && (
              <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
                <span className="text-base font-bold text-gray-400 uppercase">
                  Voucher Refund
                </span>
                {availableVouchers.map((v) => {
                  const selected = voucherRefunds.find(
                    (vr) =>
                      vr.entityId === v.entityId &&
                      vr.entityType === v.entityType,
                  );
                  const isActive = !!selected;
                  return (
                    <div
                      key={`${v.entityType}-${v.entityId}`}
                      onPointerDown={() =>
                        toggleVoucher(v.entityType ?? "", v.entityId ?? 0)
                      }
                      className={cn(
                        "flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors",
                        isActive
                          ? "bg-purple-100 ring-2 ring-purple-500"
                          : "bg-gray-50 active:bg-gray-100",
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-500">
                          Voucher #{v.entityId}
                        </span>
                        <span className="text-xs text-gray-400">
                          Cap: {fmt(v.remainingAmount)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-lg font-bold font-mono",
                          isActive ? "text-purple-700" : "text-gray-400",
                        )}
                      >
                        {isActive ? fmt(selected.amount) : fmt(0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex-1" />

            {remaining > 0 && (
              <div className="text-center text-red-600 font-bold">
                SHORT {fmt(remaining)}
              </div>
            )}
            {isOver && (
              <div className="text-center text-red-600 font-bold">
                OVER {fmt(-remaining)}
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
              {processing
                ? "Processing..."
                : `Confirm Refund ${fmt(effectiveTotal)}`}
            </button>
          </div>

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

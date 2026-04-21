import { useEffect, useMemo, useState } from "react";
import { MONEY_DP, MONEY_SCALE, PCT_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";
import { SaleLineType, SaleStoreDiscount } from "../../types/sales";
import { getSaleInvoiceById } from "../../service/sale.service";
import { printSaleInvoiceReceipt } from "../../libs/printer/sale-invoice-receipt";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import MoneyNumpad from "../../components/Numpads/MoneyNumpad";
import { InputField } from "../../components/PaymentParts";
import PaymentSummary from "./NewPaymentSummary";
import { useStoreSetting } from "../../hooks/useStoreSetting";
import UserVoucherModal from "../../components/UserVoucherModal";
import { calcSaleTotals } from "../../libs/sale/calc-sale-totals";
import { useNewPaymentCalc } from "./useNewPaymentCalc";
import {
  allocateDiscountsToLines,
  allocateTaxToLines,
} from "../../libs/sale/finalize-lines";
import {
  buildPayload,
  CreateSaleInvoicePayload,
} from "../../libs/sale/build-payload";
import { Payment } from "../../libs/sale/types";
import apiService from "../../libs/api";
import LoadingOverlay from "../../components/LoadingOverlay";

const NOTES_CENTS = [10000, 5000, 2000, 1000, 500, 200, 100, 50];
const NOTES_LABELS = ["$100", "$50", "$20", "$10", "$5", "$2", "$1", "50c"];

type NumpadTarget = "discount" | "credit" | "cash";

const fmtMoney = (cents: number) =>
  `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;

export default function NewPaymentModal({
  open,
  onClose,
  lines,
  discounts,
  memberId,
  memberLevel,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  lines: SaleLineType[];
  discounts: SaleStoreDiscount[];
  memberId: string | null;
  memberLevel: number | null;
  onComplete: () => void;
}) {
  const { storeSetting, reload } = useStoreSetting();
  const [documentDiscountMethod, setDocumentDiscountMethod] = useState<
    "percent" | "amount"
  >("percent");
  const [documentDiscountValue, setDocumentDiscountValue] = useState(0);
  const [cashReceived, setCashReceived] = useState(0);
  const [creditReceived, setCreditReceived] = useState(0);
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>("cash");
  const [numpadVal, setNumpadVal] = useState("");
  const [committedPayments, setCommittedPayments] = useState<Payment[]>([]);
  const [changeScreen, setChangeScreen] = useState<{ amount: number } | null>(
    null,
  );
  const [processing, setProcessing] = useState(false);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);

  useEffect(() => {
    if (open) reload();
  }, [reload, open]);

  const surchargeRate = storeSetting?.credit_surcharge_rate ?? 15;

  const saleTotals = useMemo(
    () => calcSaleTotals(lines, discounts),
    [lines, discounts],
  );

  const { docAdj, paymentCalc, taxCalc } = useNewPaymentCalc({
    saleTotals,
    lines,
    discounts,
    documentDiscountMethod,
    documentDiscountValue,
    committedPayments,
    stagingCash: cashReceived,
    stagingCredit: creditReceived,
    surchargeRate,
  });

  const stagingCreditEftpos = useMemo(() => {
    if (creditReceived <= 0) return 0;
    const sc = Math.round((creditReceived * surchargeRate) / PCT_SCALE);
    return creditReceived + sc;
  }, [creditReceived, surchargeRate]);

  function handleNumpadChange(newVal: string) {
    setNumpadVal(newVal);
    const cents = parseInt(newVal || "0", 10);

    if (numpadTarget === "cash") setCashReceived(cents);
    else if (numpadTarget === "credit") setCreditReceived(cents);
    else if (numpadTarget === "discount") {
      if (documentDiscountMethod === "percent") {
        setDocumentDiscountValue(cents / 100);
      } else {
        setDocumentDiscountValue(cents);
      }
    }
  }

  function switchTarget(target: NumpadTarget) {
    if (numpadTarget === target) {
      if (target === "credit" && creditReceived === 0) {
        const fill = Math.max(0, paymentCalc.remaining);
        setCreditReceived(fill);
        setNumpadVal(fill.toString());
        return;
      }
      if (
        target === "cash" &&
        cashReceived === 0 &&
        paymentCalc.remaining > 0
      ) {
        const cashRemaining = Math.max(
          0,
          docAdj.roundedDue -
            paymentCalc.totalVoucher -
            paymentCalc.totalCash -
            paymentCalc.totalCredit,
        );
        setCashReceived(cashRemaining);
        setNumpadVal(cashRemaining.toString());
        return;
      }
      return;
    }

    setNumpadTarget(target);
    let val = 0;
    if (target === "cash") val = cashReceived;
    else if (target === "credit") val = creditReceived;
    else if (target === "discount") {
      val =
        documentDiscountMethod === "percent"
          ? Math.round(documentDiscountValue * 100)
          : documentDiscountValue;
    }
    setNumpadVal(val > 0 ? val.toString() : "");
  }

  function addNote(noteCents: number) {
    const newCash = cashReceived + noteCents;
    setCashReceived(newCash);
    if (numpadTarget === "cash") {
      setNumpadVal(newCash.toString());
    }
  }

  function addPayment() {
    const newEntries: Payment[] = [];
    if (creditReceived > 0)
      newEntries.push({ type: "credit", amount: creditReceived });
    if (cashReceived > 0)
      newEntries.push({ type: "cash", amount: cashReceived });
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

  function resetState() {
    setDocumentDiscountMethod("percent");
    setDocumentDiscountValue(0);
    setCashReceived(0);
    setCreditReceived(0);
    setNumpadTarget("cash");
    setNumpadVal("");
    setCommittedPayments([]);
    setChangeScreen(null);
    setProcessing(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }
  function handleComplete() {
    resetState();
    onComplete();
  }

  async function handlePayment() {
    if (docAdj.documentDiscountAmount > saleTotals.subTotal) {
      window.alert("Discount cannot exceed subtotal");
      return;
    }
    if (paymentCalc.totalCredit > paymentCalc.effectiveDue) {
      window.alert("Credit cannot exceed total");
      return;
    }
    if (paymentCalc.remaining > 0) {
      window.alert("Payment is short");
      return;
    }

    setProcessing(true);

    const finalized = allocateDiscountsToLines(
      lines,
      discounts,
      docAdj.documentDiscountAmount,
    );
    const withTax = allocateTaxToLines(finalized, taxCalc.goodsTaxAmount);
    const member = memberId ? { id: memberId, level: memberLevel ?? 0 } : null;
    const payload = buildPayload(
      withTax,
      saleTotals,
      docAdj,
      paymentCalc,
      taxCalc,
      member,
      discounts,
    );

    try {
      const res = await apiService.post<{ id: number }>(
        "/api/sale/invoice/create",
        {
          ...payload,
        },
      );

      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to create invoice");
        setProcessing(false);
        return;
      }

      const { result: invoice } = await getSaleInvoiceById(res.result.id);

      if (paymentCalc.totalCash > 0) kickDrawer();

      if (invoice) {
        printSaleInvoiceReceipt(
          invoice,
          false,
          storeSetting?.receipt_below_text || "Thank you!",
        );
      }

      if (paymentCalc.changeAmount > 0) {
        setChangeScreen({
          amount: Math.min(paymentCalc.changeAmount, paymentCalc.totalCash),
        });
        setProcessing(false);
      } else {
        handleComplete();
      }
    } catch (e) {
      console.error(e);
      window.alert("Failed to create invoice");
      setProcessing(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      {processing && <LoadingOverlay label="Processing..." />}
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[98%] h-[96%] relative">
        <div className="flex items-center justify-between px-6 h-12 border-b border-gray-200">
          <h2 className="text-xl font-bold">Payment</h2>
          <div className="flex items-center gap-6">
            {paymentCalc.isShort && (
              <span className="text-2xl font-bold text-red-600">
                SHORT {fmtMoney(paymentCalc.shortAmount)}
              </span>
            )}
            {paymentCalc.isOverpaid && (
              <span className="text-2xl font-bold text-green-600">
                CHANGE{" "}
                {fmtMoney(
                  Math.min(paymentCalc.changeAmount, paymentCalc.totalCash),
                )}
              </span>
            )}
            {!paymentCalc.isShort && !paymentCalc.isOverpaid && (
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
                    : fmtMoney(documentDiscountValue)}
                </span>
                {docAdj.documentDiscountAmount > 0 && (
                  <span className="text-xs text-red-600">
                    -{fmtMoney(docAdj.documentDiscountAmount)}
                  </span>
                )}
              </InputField>

              <InputField
                label="Cash"
                active={numpadTarget === "cash"}
                onActivate={() => switchTarget("cash")}
              >
                <span className="text-2xl font-bold font-mono">
                  {fmtMoney(cashReceived)}
                </span>
              </InputField>

              <InputField
                label="Credit"
                active={numpadTarget === "credit"}
                onActivate={() => switchTarget("credit")}
              >
                <span className="text-2xl font-bold font-mono">
                  {fmtMoney(creditReceived)}
                </span>
                {creditReceived > 0 && (
                  <span className="text-base text-blue-700 font-semibold">
                    EFTPOS: {fmtMoney(stagingCreditEftpos)} (incl.{" "}
                    {((surchargeRate / PCT_SCALE) * 100).toFixed(2)}%)
                  </span>
                )}
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

              <button
                type="button"
                onPointerDown={() => setVoucherModalOpen(true)}
                className="h-12 rounded-xl text-base font-bold bg-purple-500 text-white active:bg-purple-600 transition-colors"
              >
                User Voucher
              </button>
            </div>
          </div>

          <div className="w-[320px] p-2 flex flex-col gap-2">
            <div className="flex-1">
              <MoneyNumpad val={numpadVal} setVal={handleNumpadChange} />
            </div>
            {numpadTarget === "cash" && (
              <div className="h-48 grid grid-cols-4 gap-2">
                {NOTES_CENTS.map((n, i) => (
                  <button
                    key={n}
                    type="button"
                    onPointerDown={() => {
                      addNote(n);
                      setNumpadTarget("cash");
                    }}
                    className="flex-1 text-xl font-bold bg-green-50 text-green-800 active:bg-green-200 transition-colors"
                  >
                    +{NOTES_LABELS[i]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {committedPayments.length > 0 && (
            <div className="w-[300px] overflow-y-auto p-2 flex flex-col gap-1">
              <span className="text-base font-bold text-gray-400 uppercase px-1">
                Payments
              </span>
              {committedPayments.map((p, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2",
                    p.type === "cash"
                      ? "bg-green-50"
                      : p.type === "voucher"
                        ? "bg-purple-50"
                        : "bg-blue-50",
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-base font-bold text-gray-500 uppercase">
                      {p.type}
                    </span>
                    <span className="text-base font-bold font-mono">
                      {fmtMoney(p.amount)}
                    </span>
                    {p.type === "credit" && (
                      <span className="text-lg font-bold text-blue-700">
                        EFTPOS:{" "}
                        {fmtMoney(paymentCalc.allPaymentLines[i]?.eftpos ?? 0)}
                      </span>
                    )}
                  </div>
                  <div
                    onPointerDown={() => removePayment(i)}
                    className="w-12 h-12 text-xl flex items-center justify-center rounded text-red-400 active:bg-red-100 font-bold shrink-0"
                  >
                    ✕
                  </div>
                </div>
              ))}
            </div>
          )}

          <PaymentSummary
            subTotal={saleTotals.subTotal}
            lineDiscountAmount={saleTotals.lineDiscountAmount}
            documentDiscountAmount={docAdj.documentDiscountAmount}
            documentDiscountMethod={documentDiscountMethod}
            documentDiscountValue={documentDiscountValue}
            totalSurcharge={paymentCalc.totalSurcharge}
            rounding={paymentCalc.effectiveRounding}
            roundedDue={docAdj.roundedDue}
            effectiveDue={paymentCalc.effectiveDue}
            totalCash={paymentCalc.totalCash}
            totalCredit={paymentCalc.totalCredit}
            totalVoucher={paymentCalc.totalVoucher}
            taxAmount={taxCalc.taxAmount}
            totalDiscountAmount={docAdj.totalDiscountAmount}
            totalEftpos={paymentCalc.totalEftpos}
            isOverpaid={paymentCalc.isOverpaid}
            changeAmount={paymentCalc.changeAmount}
            canPay={paymentCalc.canPay && !processing}
            onPay={handlePayment}
            surchargeRate={surchargeRate}
            processing={processing}
          />
        </div>

        {changeScreen && (
          <div className="absolute inset-0 bg-black flex flex-col items-center justify-center z-10 rounded-2xl">
            <span className="text-white text-3xl font-medium mb-4">CHANGE</span>
            <span className="text-green-400 text-[120px] font-bold leading-none">
              {fmtMoney(changeScreen.amount)}
            </span>
            <div className="mt-12 flex gap-4">
              <button
                type="button"
                onPointerDown={() => kickDrawer()}
                className="px-8 py-4 bg-amber-500 text-white text-xl font-bold rounded-xl active:bg-amber-600"
              >
                Kick Drawer
              </button>
              <button
                type="button"
                onPointerDown={handleComplete}
                className="px-12 py-4 bg-white text-black text-2xl font-bold rounded-xl active:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        )}

        <UserVoucherModal
          open={voucherModalOpen}
          onClose={() => setVoucherModalOpen(false)}
          onSelect={(voucher) => {
            const rem = Math.max(0, paymentCalc.remaining);
            if (rem <= 0) {
              window.alert("Payment is already fulfilled");
              setVoucherModalOpen(false);
              return;
            }
            const duplicate = committedPayments.some(
              (p) => p.type === "voucher" && p.entityId === voucher.id,
            );
            if (duplicate) {
              window.alert("This voucher is already applied");
              setVoucherModalOpen(false);
              return;
            }
            const amount = Math.min(voucher.left_amount, rem);
            setCommittedPayments((prev) => [
              ...prev,
              {
                type: "voucher",
                amount,
                entityType: "user-voucher",
                entityId: voucher.id,
                voucher_balance: voucher.left_amount,
              },
            ]);
            setVoucherModalOpen(false);
          }}
        />
      </div>
    </div>
  );
}

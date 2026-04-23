// PaymentModalForRepay — 원본 SALE 을 전량 환불 + 새 tender 로 재결제 하는
// 원자적 flow 의 입력 UI. PaymentModal 구조를 거울처럼 차용하되:
//   - Cart (SalesStore) 의존성 없음. Lines 는 원본 invoice.rows 에서 변환.
//   - Line 편집 불가 — 물건은 이미 손님 쪽 (qty/price 변경 금지).
//   - SPEND 토글 없음 (repay 는 무조건 SALE).
//   - 10분 타이머 expired 시 자동 비활성.
//   - Submit 시 POST /api/sale/repay (refund + newSale 원샷) 호출 후 영수증 2장.
//
// 공유 컴포넌트: CashInput / CreditInput / GiftCardInput / UserVoucherInput /
//              SearchUserVoucherModal / usePaymentCal (+ billPortionOf 등)

import { useEffect, useMemo, useState } from "react";
import { cn } from "../../libs/cn";
import { useStoreSetting } from "../../hooks/useStoreSetting";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import type { PaymentQueueItem } from "../../screens/SaleScreen/PaymentModal/types";
import {
  billPortionOf,
  calcLeft,
  eftposAmountOf,
  round5,
  usePaymentCal,
} from "../../screens/SaleScreen/PaymentModal/usePaymentCal";
import CashInput from "../../screens/SaleScreen/PaymentModal/CashInput";
import CreditInput from "../../screens/SaleScreen/PaymentModal/CreditInput";
import GiftCardInput from "../../screens/SaleScreen/PaymentModal/GiftCardInput";
import UserVoucherInput from "../../screens/SaleScreen/PaymentModal/UserVoucherInput";
import type { Voucher } from "../../service/voucher.service";
import {
  getSaleInvoiceById,
  repayInvoice,
  type RepayPayload,
  type SaleInvoiceDetail,
} from "../../service/sale.service";
import { invoiceRowsToLines } from "../../libs/sale/invoice-row-to-line";
import LoadingOverlay from "../LoadingOverlay";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import { printSaleInvoiceReceipt } from "../../libs/printer/sale-invoice-receipt";
import RepayLineViewer from "./RepayLineViewer";
import RepayOriginalPayments from "./RepayOriginalPayments";

// PaymentModal 과 동일한 UI tender slot 구분.
type TenderSlot =
  | "CASH"
  | "CREDIT"
  | "USER_VOUCHER"
  | "CUSTOMER_VOUCHER"
  | "GIFTCARD";

const PAYMENT_TYPE: TenderSlot[] = [
  "CASH",
  "CREDIT",
  "USER_VOUCHER",
  "GIFTCARD",
];

const TENDER_LABEL: Record<TenderSlot, string> = {
  CASH: "Cash",
  CREDIT: "Credit",
  USER_VOUCHER: "Staff Voucher",
  CUSTOMER_VOUCHER: "Customer Voucher",
  GIFTCARD: "Gift Card",
};

function makeDefaultStage(slot: TenderSlot): PaymentQueueItem {
  switch (slot) {
    case "CASH":
      return { key: "staged", tender: "CASH", amount: 0, cashReceived: 0 };
    case "CREDIT":
      return { key: "staged", tender: "CREDIT", amount: 0 };
    case "GIFTCARD":
      return { key: "staged", tender: "GIFTCARD", amount: 0 };
    case "USER_VOUCHER":
      return {
        key: "staged",
        tender: "VOUCHER",
        amount: 0,
        entityType: "user-voucher",
        entityId: 0,
        entityLabel: "",
      };
    case "CUSTOMER_VOUCHER":
      return {
        key: "staged",
        tender: "VOUCHER",
        amount: 0,
        entityType: "customer-voucher",
        entityId: 0,
        entityLabel: "",
      };
  }
}

function slotOf(p: PaymentQueueItem): TenderSlot {
  if (p.tender === "VOUCHER") {
    return p.entityType === "user-voucher"
      ? "USER_VOUCHER"
      : "CUSTOMER_VOUCHER";
  }
  return p.tender;
}

function isStagedActive(p: PaymentQueueItem): boolean {
  if (p.tender === "CASH") return p.cashReceived > 0;
  return p.amount > 0;
}

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// 원본 payments 에 CASH 가 있는지 판정 — drawer kick 시 필요.
function hasCashInPayments(
  payments: { type: string; amount: number }[],
): boolean {
  return payments.some((p) => p.type === "CASH" && p.amount > 0);
}

interface Props {
  invoice: SaleInvoiceDetail;
  expiresAt: number; // ms epoch — 10분 타이머 만료 시각 (canRepay 반환값)
  onClose: () => void;
  onSuccess: () => void; // 성공 후 부모 viewer 에서 refetch 등 처리
}

export default function PaymentModalForRepay({
  invoice,
  expiresAt,
  onClose,
  onSuccess,
}: Props) {
  const { storeSetting } = useStoreSetting();

  const [stagedPayment, setStagedPayment] = useState<PaymentQueueItem>(
    makeDefaultStage("CASH"),
  );
  const [payments, setPayments] = useState<PaymentQueueItem[]>([]);
  const [stagedVoucher, setStagedVoucher] = useState<Voucher | null>(null);

  const credit_surcharge_rate = storeSetting?.credit_surcharge_rate ?? 15;

  // Lines — 원본 rows 고정. usePaymentCal 이 linesTotal / lineTax 만 읽음.
  const lines = useMemo(() => invoiceRowsToLines(invoice.rows), [invoice.rows]);

  // 10분 타이머 — 현재 시각 상태로 1초마다 rerender → expired 면 submit 자동 비활성.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const expired = now >= expiresAt;
  const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  const combinedPayments = useMemo(
    () => [stagedPayment, ...payments],
    [stagedPayment, payments],
  );

  const cal = usePaymentCal({
    lines,
    credit_surcharge_rate,
    payments: combinedPayments,
  });

  const left = useMemo(
    () => calcLeft(payments, cal.due, credit_surcharge_rate),
    [payments, cal.due, credit_surcharge_rate],
  );

  const exactCashAmount = payments.some((p) => p.tender !== "CASH")
    ? left
    : round5(left);

  // CREDIT staged clamp (sale 과 동일 — PaymentModal 참고)
  useEffect(() => {
    setStagedPayment((prev) => {
      if (prev.tender === "CREDIT") {
        const bill = billPortionOf(prev, credit_surcharge_rate);
        if (bill <= left) return prev;
        const next = eftposAmountOf(left, credit_surcharge_rate);
        return next === prev.amount ? prev : { ...prev, amount: next };
      }
      return prev;
    });
  }, [left, credit_surcharge_rate]);

  const derivedPayments = useMemo(
    () =>
      combinedPayments
        .filter((p) => p.key !== "staged" || isStagedActive(p))
        .map((p) =>
          p.tender === "CASH"
            ? { ...p, amount: cal.cashAllocations.get(p.key) ?? 0 }
            : p,
        ),
    [combinedPayments, cal.cashAllocations],
  );

  const usedUserVoucherIds = useMemo(
    () =>
      payments
        .filter(
          (p) => p.tender === "VOUCHER" && p.entityType === "user-voucher",
        )
        .map((p) => (p as { entityId: number }).entityId),
    [payments],
  );

  const tenderSums = useMemo(() => {
    const sums = new Map<TenderSlot, number>();
    sums.set("CASH", cal.cashApplied);
    for (const p of payments) {
      if (p.tender === "CASH") continue;
      const slot = slotOf(p);
      sums.set(slot, (sums.get(slot) ?? 0) + p.amount);
    }
    return sums;
  }, [payments, cal.cashApplied]);

  // Repay 버튼 활성 조건: 완납 + rows 존재 + 만료 전 + 처리 중 아님
  const [processing, setProcessing] = useState(false);
  const repayDisabled =
    lines.length === 0 ||
    cal.remaining !== 0 ||
    cal.total <= 0 ||
    expired ||
    processing;

  // Completion — change > 0 시 ChangeOverlay (PaymentModal 과 동일 패턴)
  const [completedInfo, setCompletedInfo] = useState<{
    newSaleId: number;
    newSaleDetail: SaleInvoiceDetail | null;
    total: number;
    paid: number;
    cashReceived: number;
    change: number;
  } | null>(null);

  const cashLocked = payments.some((p) => p.tender !== "CASH");

  function changeSlot(slot: TenderSlot) {
    if (slot === "CASH" && cashLocked) return;
    const currentSlot = slotOf(stagedPayment);
    if (currentSlot === slot) return;
    if (isStagedActive(stagedPayment)) {
      const draftDisp =
        stagedPayment.tender === "CASH"
          ? stagedPayment.cashReceived
          : stagedPayment.amount;
      const ok = window.confirm(
        `Discard staged ${currentSlot.replace("_", " ")} ($${fmtMoney(draftDisp)}) and switch to ${slot.replace("_", " ")}?`,
      );
      if (!ok) return;
    }
    setStagedPayment(makeDefaultStage(slot));
    setStagedVoucher(null);
  }

  function commitStaged() {
    if (!isStagedActive(stagedPayment)) return;
    if (stagedPayment.tender !== "CASH" && stagedPayment.amount <= 0) return;
    if (stagedPayment.tender === "VOUCHER" && stagedPayment.entityId <= 0)
      return;
    setPayments((prev) => [
      ...prev,
      { ...stagedPayment, key: crypto.randomUUID() },
    ]);
    setStagedPayment(makeDefaultStage(slotOf(stagedPayment)));
    setStagedVoucher(null);
  }

  function handleRemovePayment(key: string) {
    const p = payments.find((pp) => pp.key === key);
    if (!p) return;
    const label = p.tender === "GIFTCARD" ? "GIFT CARD" : p.tender;
    const disp = p.tender === "CASH" ? p.cashReceived : p.amount;
    const ok = window.confirm(
      `Remove ${label} payment ($${fmtMoney(disp)})?`,
    );
    if (!ok) return;
    setPayments((prev) => prev.filter((pp) => pp.key !== key));
  }

  function setStagedCashReceived(next: number) {
    setStagedPayment({
      key: "staged",
      tender: "CASH",
      cashReceived: next,
      amount: 0,
    });
  }

  function setStagedCreditBillPortion(billPortion: number) {
    const cappedBill = Math.min(billPortion, left);
    setStagedPayment({
      key: "staged",
      tender: "CREDIT",
      amount: eftposAmountOf(cappedBill, credit_surcharge_rate),
    });
  }

  function setStagedGiftcardAmount(amount: number) {
    setStagedPayment({
      key: "staged",
      tender: "GIFTCARD",
      amount: Math.min(amount, left),
    });
  }

  function selectUserVoucher(
    user: { id: number; name: string },
    voucher: Voucher,
  ) {
    setStagedVoucher(voucher);
    setStagedPayment({
      key: "staged",
      tender: "VOUCHER",
      entityType: "user-voucher",
      entityId: voucher.id,
      entityLabel: user.name,
      amount: 0,
    });
  }

  function setStagedVoucherAmount(amount: number) {
    setStagedPayment((prev) => {
      if (prev.tender !== "VOUCHER") return prev;
      return { ...prev, amount };
    });
  }

  // ── Submit ─────────────────────────────────────────────────
  // Build payload (buildPayments 로직 인라인 — CASH 집약 + non-cash pass-through).
  function buildRepayPayments(): RepayPayload["payments"] {
    const staged = stagedPayment;
    const stagedReady =
      isStagedActive(staged) &&
      staged.tender !== "CASH" &&
      staged.amount > 0 &&
      (staged.tender !== "VOUCHER" || staged.entityId > 0);

    const effective: PaymentQueueItem[] = stagedReady
      ? [...payments, staged]
      : [...payments];

    const out: RepayPayload["payments"] = [];
    if (cal.cashApplied > 0) {
      out.push({ type: "CASH", amount: cal.cashApplied });
    }
    for (const p of effective) {
      if (p.tender === "CASH") continue;
      if (p.amount <= 0) continue;
      if (p.tender === "VOUCHER") {
        out.push({
          type: "VOUCHER",
          amount: p.amount,
          entityType: p.entityType,
          entityId: p.entityId,
          entityLabel: p.entityLabel,
        });
        continue;
      }
      out.push({ type: p.tender, amount: p.amount });
    }
    return out;
  }

  async function handleRepay() {
    if (repayDisabled) return;

    // 1-stage confirm (사용자 결정 — Q 답변에 따라 단일 단계).
    const ok = window.confirm(
      "Confirm repay? This will refund the original invoice and create a new sale.\n\n" +
        "Two receipts will print (refund first, then new sale).",
    );
    if (!ok) return;

    const payload: RepayPayload = {
      originalInvoiceId: invoice.id,
      payments: buildRepayPayments(),
      cashChange: cal.change,
    };

    setProcessing(true);
    try {
      const res = await repayInvoice(payload);
      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to repay");
        return;
      }
      const { refund, newSale } = res.result;

      // 영수증 / drawer 용 detail 병렬 조회
      const [refundDetailRes, newSaleDetailRes] = await Promise.all([
        getSaleInvoiceById(refund.id),
        getSaleInvoiceById(newSale.id),
      ]);
      const refundDetail = refundDetailRes.ok ? refundDetailRes.result : null;
      const newSaleDetail = newSaleDetailRes.ok
        ? newSaleDetailRes.result
        : null;

      // Drawer — 원본에 CASH 있었으면 (돌려줘야 할 현금) OR 새 결제에 CASH 있으면
      // (받을 현금) — 둘 다 한 번의 kick 으로 충분 (cashier 가 현장에서 양방향 처리).
      const origHasCash = hasCashInPayments(invoice.payments);
      const newHasCash = cal.cashIntent > 0;
      if (origHasCash || newHasCash) {
        try {
          await kickDrawer();
        } catch (e) {
          console.error("kickDrawer failed:", e);
        }
      }

      // Refund receipt → 1 초 → new sale receipt (R3)
      if (refundDetail) {
        try {
          await printSaleInvoiceReceipt(refundDetail);
        } catch (e) {
          console.error("printSaleInvoiceReceipt (refund) failed:", e);
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
      if (newSaleDetail) {
        try {
          await printSaleInvoiceReceipt(newSaleDetail);
        } catch (e) {
          console.error("printSaleInvoiceReceipt (newSale) failed:", e);
        }
      }

      if (cal.change > 0) {
        setCompletedInfo({
          newSaleId: newSale.id,
          newSaleDetail,
          total: cal.total,
          paid: cal.paid,
          cashReceived: cal.cashIntent,
          change: cal.change,
        });
      } else {
        onSuccess();
        onClose();
      }
    } finally {
      setProcessing(false);
    }
  }

  function finishRepay() {
    setCompletedInfo(null);
    onSuccess();
    onClose();
  }

  async function handleKickDrawer() {
    try {
      await kickDrawer();
    } catch (e) {
      console.error("kickDrawer failed:", e);
    }
  }

  async function handleReprint() {
    if (!completedInfo) return;
    try {
      let detail: SaleInvoiceDetail | null = completedInfo.newSaleDetail;
      if (!detail) {
        const res = await getSaleInvoiceById(completedInfo.newSaleId);
        if (res.ok && res.result) detail = res.result;
      }
      if (detail) await printSaleInvoiceReceipt(detail, true);
    } catch (e) {
      console.error("reprint failed:", e);
    }
  }

  return (
    <div className="fixed inset-0 z-[1600] p-4 w-screen h-screen bg-black/50">
      {processing && <LoadingOverlay label="Repaying..." />}
      {completedInfo && (
        <ChangeOverlay
          info={completedInfo}
          onKickDrawer={handleKickDrawer}
          onReprint={handleReprint}
          onClose={finishRepay}
        />
      )}
      <div className="bg-white w-full h-full rounded-md flex flex-col divide-y divide-gray-300">
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold">Repay</h2>
            <span className="text-xs text-gray-500 font-mono">
              Original: {invoice.serial ?? `#${invoice.id}`} · $
              {fmtMoney(invoice.total)}
            </span>
            <span
              className={cn(
                "text-xs font-mono",
                expired ? "text-red-600 font-bold" : "text-amber-600",
              )}
            >
              {expired
                ? "EXPIRED"
                : `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")} remaining`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleKickDrawer}
              className="px-4 h-9 rounded-md bg-blue-600 text-white font-semibold text-sm active:bg-blue-700"
            >
              Open Drawer
            </button>
            <button
              type="button"
              onClick={() => onClose()}
              className="px-4 h-9 rounded-md bg-red-500 text-white font-semibold text-sm active:bg-red-600"
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-12 divide-x divide-gray-300 min-h-0">
          {/* Lines (read-only) */}
          <div className="col-span-3">
            <RepayLineViewer rows={invoice.rows} />
          </div>

          {/* Payment Type */}
          <div className="flex flex-col gap-2 p-2">
            {PAYMENT_TYPE.map((pt, idx) => {
              const isActived = slotOf(stagedPayment) === pt;
              const isDisabled = pt === "CASH" && cashLocked;
              const strs = pt.split("_");
              return (
                <button
                  key={`pt_${idx}`}
                  type="button"
                  onClick={() => changeSlot(pt)}
                  disabled={isDisabled}
                  className={cn(
                    "border border-gray-300 h-16 rounded-md text-sm",
                    isDisabled
                      ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      : isActived
                        ? "bg-blue-500 text-white"
                        : "bg-white text-black",
                  )}
                >
                  {strs.map((st, lIdx) => (
                    <div key={`${lIdx}`}>{st}</div>
                  ))}
                </button>
              );
            })}
          </div>

          {/* Keypad / inputs */}
          <div className="col-span-3 p-3 flex flex-col gap-2 relative">
            {stagedPayment.tender === "CASH" && (
              <CashInput
                cashReceived={stagedPayment.cashReceived}
                setCashReceived={setStagedCashReceived}
                left={left}
                exactAmount={exactCashAmount}
                onCommit={commitStaged}
              />
            )}
            {stagedPayment.tender === "CREDIT" && (
              <CreditInput
                billPortion={billPortionOf(stagedPayment, credit_surcharge_rate)}
                setBillPortion={setStagedCreditBillPortion}
                left={left}
                surchargeRate={credit_surcharge_rate}
                onCommit={commitStaged}
              />
            )}
            {stagedPayment.tender === "GIFTCARD" && (
              <GiftCardInput
                amount={stagedPayment.amount}
                setAmount={setStagedGiftcardAmount}
                left={left}
                onCommit={commitStaged}
              />
            )}
            {stagedPayment.tender === "VOUCHER" &&
              stagedPayment.entityType === "user-voucher" && (
                <UserVoucherInput
                  amount={stagedPayment.amount}
                  setAmount={setStagedVoucherAmount}
                  left={left}
                  voucher={stagedVoucher}
                  userLabel={stagedPayment.entityLabel}
                  usedVoucherIds={usedUserVoucherIds}
                  onSelectVoucher={selectUserVoucher}
                  onCommit={commitStaged}
                />
              )}
          </div>

          {/* Pending payments list */}
          <div className="col-span-2 flex flex-col divide-y divide-gray-300 min-h-0">
            <div className="h-14 px-3 flex items-center font-medium">
              New Payments ({payments.length}
              {isStagedActive(stagedPayment) && " + 1 draft"})
            </div>
            <div className="flex-1 overflow-y-auto">
              {derivedPayments.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  No payments added
                </div>
              ) : (
                derivedPayments.map((p) => (
                  <PaymentRow
                    key={p.key}
                    item={p}
                    surchargeRate={credit_surcharge_rate}
                    onRemove={
                      p.key === "staged"
                        ? undefined
                        : () => handleRemovePayment(p.key)
                    }
                    draft={p.key === "staged"}
                  />
                ))
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="col-span-3 p-3 flex flex-col gap-3 bg-gray-50 overflow-y-auto">
            <RepayOriginalPayments invoice={invoice} />

            <section className="bg-white border border-gray-200 rounded-md p-3 space-y-1 font-mono text-sm">
              <SummaryRow label="SUBTOTAL" value={cal.net} />
              <SummaryRow label="GST" value={cal.tax} />
              <div className="border-t border-gray-200 my-1" />
              <SummaryRow label="LINES TOTAL" value={cal.linesTotal} />
              {cal.rounding !== 0 && (
                <SummaryRow label="ROUNDING" value={cal.rounding} />
              )}
              {cal.creditSurcharge > 0 && (
                <SummaryRow label="SURCHARGE" value={cal.creditSurcharge} />
              )}
              <div className="border-t border-gray-200 my-1" />
              <SummaryRow label="NEW TOTAL" value={cal.total} big bold />
            </section>

            <section className="bg-white border border-gray-200 rounded-md p-3 space-y-1 text-sm">
              <div className="text-[10px] uppercase tracking-[0.15em] text-gray-500">
                New Payments
              </div>
              {Array.from(tenderSums.entries()).filter(
                ([, amt]) => amt > 0,
              ).length === 0 ? (
                <div className="text-gray-400 text-xs">None yet</div>
              ) : (
                Array.from(tenderSums.entries())
                  .filter(([, amt]) => amt > 0)
                  .map(([slot, amt]) => (
                    <div key={slot} className="flex justify-between">
                      <span className="text-gray-700">
                        {TENDER_LABEL[slot]}
                      </span>
                      <span className="font-mono">${fmtMoney(amt)}</span>
                    </div>
                  ))
              )}
            </section>

            <section className="bg-white border border-gray-200 rounded-md p-3 space-y-1 font-mono text-sm">
              <SummaryRow label="PAID" value={cal.paid} />
              <SummaryRow
                label="REMAINING"
                value={cal.remaining}
                highlight={cal.remaining > 0 ? "warn" : undefined}
              />
              {cal.change > 0 && (
                <SummaryRow label="CHANGE" value={cal.change} highlight="ok" />
              )}
            </section>

            <button
              type="button"
              onClick={handleRepay}
              disabled={repayDisabled}
              className={cn(
                "mt-auto h-16 rounded-lg font-bold text-lg tracking-wide transition",
                repayDisabled
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-emerald-600 text-white active:bg-emerald-700",
              )}
            >
              {expired ? "TIME EXPIRED" : "REPAY NOW"}
              {!repayDisabled && (
                <span className="ml-2 text-base font-mono">
                  ${fmtMoney(cal.total)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reused subcomponents (PaymentModal 과 동일 패턴 — 내부용) ───────────────

function PaymentRow({
  item,
  surchargeRate,
  onRemove,
  draft,
}: {
  item: PaymentQueueItem;
  surchargeRate: number;
  onRemove?: () => void;
  draft?: boolean;
}) {
  const billPortion = billPortionOf(item, surchargeRate);
  const suffix = paymentRowSuffix(item);

  return (
    <div
      className={cn(
        "flex items-stretch px-3 py-3 gap-3 border-b border-gray-100 last:border-b-0",
        draft && "bg-blue-50 border-l-4 border-l-blue-500",
      )}
    >
      <div className="flex-1 flex flex-col gap-1 min-w-0 leading-snug">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-blue-700 tracking-wider">
            {item.tender === "GIFTCARD" ? "GIFT CARD" : item.tender}
          </span>
          {draft && (
            <span className="text-[9px] text-blue-500 font-normal">DRAFT</span>
          )}
        </div>
        <div className="font-mono text-sm break-words">
          ${fmtMoney(billPortion)}
        </div>
        {suffix && (
          <div className="font-mono text-xs text-gray-400 break-words">
            ({suffix})
          </div>
        )}
        {item.tender === "VOUCHER" && item.entityLabel && (
          <div className="text-xs text-gray-500 truncate">
            {item.entityLabel}
          </div>
        )}
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="self-stretch w-10 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 active:bg-gray-200 text-base shrink-0"
        >
          ✕
        </button>
      ) : (
        <span className="w-10 shrink-0" />
      )}
    </div>
  );
}

function paymentRowSuffix(item: PaymentQueueItem): string | null {
  switch (item.tender) {
    case "CREDIT":
      return `$${fmtMoney(item.amount)}`;
    case "CASH":
      return item.cashReceived > 0
        ? `Rcv $${fmtMoney(item.cashReceived)}`
        : null;
    case "VOUCHER":
    case "GIFTCARD":
      return null;
  }
}

function ChangeOverlay({
  info,
  onKickDrawer,
  onReprint,
  onClose,
}: {
  info: {
    newSaleId: number;
    total: number;
    paid: number;
    cashReceived: number;
    change: number;
  };
  onKickDrawer: () => void;
  onReprint: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-6"
      style={{ zIndex: 9998 }}
    >
      <div className="bg-white rounded-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-gray-500">
            Change Due
          </div>
          <div className="text-5xl font-bold text-emerald-600 font-mono mt-1">
            ${fmtMoney(info.change)}
          </div>
        </div>
        <div className="bg-gray-50 rounded p-3 space-y-1 font-mono text-sm">
          <div className="flex justify-between">
            <span>TOTAL</span>
            <span>${fmtMoney(info.total)}</span>
          </div>
          <div className="flex justify-between">
            <span>CASH RCVD</span>
            <span>${fmtMoney(info.cashReceived)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onKickDrawer}
            className="flex-1 h-12 rounded-md bg-blue-600 text-white font-bold text-sm active:bg-blue-700"
          >
            Open Drawer
          </button>
          <button
            type="button"
            onClick={onReprint}
            className="flex-1 h-12 rounded-md bg-gray-200 text-gray-800 font-bold text-sm active:bg-gray-300"
          >
            Reprint
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-14 rounded-md bg-emerald-600 text-white font-bold text-lg active:bg-emerald-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  big,
  bold,
  highlight,
}: {
  label: string;
  value: number;
  big?: boolean;
  bold?: boolean;
  highlight?: "warn" | "ok";
}) {
  const color =
    highlight === "warn"
      ? "text-amber-600"
      : highlight === "ok"
        ? "text-emerald-600"
        : "text-gray-800";
  return (
    <div
      className={cn(
        "flex justify-between",
        big && "text-lg",
        bold && "font-bold",
        color,
      )}
    >
      <span>{label}</span>
      <span>${fmtMoney(value)}</span>
    </div>
  );
}


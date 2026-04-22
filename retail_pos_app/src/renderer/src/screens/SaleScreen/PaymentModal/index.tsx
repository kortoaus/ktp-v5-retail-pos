import { useEffect, useMemo, useState } from "react";
import { useSalesStore } from "../../../store/SalesStore";
import { cn } from "../../../libs/cn";
import { useStoreSetting } from "../../../hooks/useStoreSetting";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../../libs/constants";
import type { PaymentQueueItem } from "./types";
import {
  billPortionOf,
  calcLeft,
  eftposAmountOf,
  round5,
  usePaymentCal,
} from "./usePaymentCal";
import CashInput from "./CashInput";
import CreditInput from "./CreditInput";
import GiftCardInput from "./GiftCardInput";
import UserVoucherInput from "./UserVoucherInput";
import { Voucher } from "../../../service/voucher.service";
import {
  createSale,
  createSpend,
  getSaleInvoiceById,
  SaleInvoiceCreated,
  SaleInvoiceDetail,
} from "../../../service/sale.service";
import {
  buildSalePayload,
  buildSpendPayload,
} from "../../../libs/sale/build-payload";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { kickDrawer } from "../../../libs/printer/kick-drawer";
import { printSaleInvoiceReceipt } from "../../../libs/printer/sale-invoice-receipt";

// UI-level tender slot. Distinct from PaymentType in the schema:
//   USER_VOUCHER + CUSTOMER_VOUCHER both map to tender="VOUCHER" in the
//   PaymentQueueItem (and SaleInvoicePayment), discriminated by entityType.
type TenderSlot =
  | "CASH"
  | "CREDIT"
  | "USER_VOUCHER"
  | "CUSTOMER_VOUCHER"
  | "GIFTCARD";

// PAYMENT_TYPE drives the picker buttons. CUSTOMER_VOUCHER hidden until CRM
// lookup is wired (D-21).
const PAYMENT_TYPE: TenderSlot[] = [
  "CASH",
  "CREDIT",
  "USER_VOUCHER",
  "GIFTCARD",
]; // todo: CUSTOMER_VOUCHER

// Summary 패널 — tender 별 합계 표시용 라벨.
const TENDER_LABEL: Record<TenderSlot, string> = {
  CASH: "Cash",
  CREDIT: "Credit",
  USER_VOUCHER: "Staff Voucher",
  CUSTOMER_VOUCHER: "Customer Voucher",
  GIFTCARD: "Gift Card",
};

// Empty draft for each slot. `key: "staged"` is a fixed marker — when the
// staged item is committed to `payments`, a uuid replaces it. Never two
// staged items, so no key collision risk.
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

// Derive UI slot from a staged/committed item — needed because VOUCHER tender
// covers two UI slots.
function slotOf(p: PaymentQueueItem): TenderSlot {
  if (p.tender === "VOUCHER") {
    return p.entityType === "user-voucher"
      ? "USER_VOUCHER"
      : "CUSTOMER_VOUCHER";
  }
  return p.tender; // CASH | CREDIT | GIFTCARD
}

// "Has the cashier put anything into this draft yet?" CASH uses cashReceived
// because amount is derived (allocation). Others use amount as the source.
function isStagedActive(p: PaymentQueueItem): boolean {
  if (p.tender === "CASH") return p.cashReceived > 0;
  return p.amount > 0;
}

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// qty (×QTY_SCALE) → display string. 정수면 그대로, 소수 weight 면 뒤 0 제거.
const fmtQty = (q: number) => {
  const v = q / QTY_SCALE;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
};

export default function PaymentModal({ onCancel }: { onCancel: () => void }) {
  const { storeSetting } = useStoreSetting();
  const [stagedPayment, setStagedPayment] = useState<PaymentQueueItem>(
    makeDefaultStage("CASH"),
  );
  const [payments, setPayments] = useState<PaymentQueueItem[]>([]);
  // Live Voucher object for the currently staged USER_VOUCHER. Held separately
  // because PaymentQueueItem only carries entityId/entityLabel — not balance.
  // Cleared on slot change or commit.
  const [stagedVoucher, setStagedVoucher] = useState<Voucher | null>(null);

  // SPEND 토글 모드 — ON 이면 tender picker (4종) 비활성 + keypad 영역 overlay,
  // Summary 의 COMPLETE SALE 자리에 RECORD SPEND 버튼. 토글할 때마다 staged /
  // committed / voucher 전부 리셋 (숨겨진 state 없도록).
  const [spendMode, setSpendMode] = useState(false);

  function toggleSpendMode() {
    setSpendMode((prev) => !prev);
    setPayments([]);
    setStagedPayment(makeDefaultStage("CASH"));
    setStagedVoucher(null);
  }
  const { carts, activeCartIndex, clearActiveCart } = useSalesStore();
  const lines = useMemo(
    () => carts[activeCartIndex]?.lines ?? [],
    [carts, activeCartIndex],
  );

  const credit_surcharge_rate = storeSetting?.credit_surcharge_rate ?? 15; // 15: 1.5%, 150:15%, 1500:150%

  // Combined list for math. Always include staged so the hook sees the
  // tender presence (e.g. CASH staged at $0 should still trigger rounding).
  // Empty drafts are filtered out for display below.
  const combinedPayments = useMemo(
    () => [stagedPayment, ...payments],
    [stagedPayment, payments],
  );

  const cal = usePaymentCal({
    lines,
    credit_surcharge_rate,
    payments: combinedPayments,
  });

  // `left` = cap for the active tender input. Derived from committed-only
  // payments (excludes staged). Mirrors the hook's allocation logic.
  const left = useMemo(
    () => calcLeft(payments, cal.due, credit_surcharge_rate),
    [payments, cal.due, credit_surcharge_rate],
  );

  // EXACT 버튼 값. Committed 에 non-cash 가 하나도 없으면 round5(left) 로 넣어줘서
  // cashIntent >= roundedCashTarget 조건을 충족시킴 → rounding 자동 작동.
  // Non-cash 가 committed 되면 그냥 left (mixed tender 는 round 금지 — D-section 3).
  const exactCashAmount = payments.some((p) => p.tender !== "CASH")
    ? left
    : round5(left);

  // CREDIT staged needs clamping when `left` shrinks (e.g. another committed
  // payment grows the non-cash bill, or cash absorbs more). For CASH, the
  // amount is fully derived (cashAllocations) — no sync needed.
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

  // For pending list display: drop the staged item if it's an empty draft,
  // then replace each CASH item's stored `amount` with its FIFO allocation.
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

  // Committed 된 user-voucher 의 voucher id 목록. Search modal 에서 이미 쓰인
  // voucher 를 disabled 로 표시 → 중복 선택 차단 (Option A, D-20).
  const usedUserVoucherIds = useMemo(
    () =>
      payments
        .filter(
          (p) => p.tender === "VOUCHER" && p.entityType === "user-voucher",
        )
        .map((p) => (p as { entityId: number }).entityId),
    [payments],
  );

  // Summary 패널 — tender slot 별 합계 (CASH 는 cashApplied 로 집약, 나머지는
  // per-payment amount 합). 0 인 slot 은 렌더 단계에서 filter.
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

  // Complete Sale — 완납 + 라인 존재 시 활성. 항상 버튼 노출, 불만족 시 disabled.
  const completeDisabled =
    lines.length === 0 || cal.remaining !== 0 || cal.total <= 0;

  // Completion flow state:
  //   processing     — createSale 요청 중. LoadingOverlay 로 유저 행동 블락.
  //   completedInfo  — change > 0 인 경우의 snapshot. ChangeOverlay 에서
  //                    drawer kick / reprint / close 제공. close → cart clear +
  //                    modal 종료. change === 0 이면 overlay 없이 바로 종료.
  const [processing, setProcessing] = useState(false);
  const [completedInfo, setCompletedInfo] = useState<{
    invoice: SaleInvoiceCreated;
    detail: SaleInvoiceDetail | null; // reprint 때 재조회 없이 바로 사용
    total: number;
    paid: number;
    cashReceived: number;
    change: number;
  } | null>(null);

  async function handleCompleteSale() {
    if (completeDisabled || processing) return;
    const cart = carts[activeCartIndex];
    if (!cart) return;

    // Non-cash staged (CREDIT / GIFTCARD / VOUCHER) 가 ready 면 committed 처럼
    // payload 에 포함 → ADD 누르는 단계 생략 (1-step Complete flow).
    // CASH staged 는 cal.cashApplied 에 이미 반영돼 있어 builder 가 스스로 제외.
    const stagedReady =
      isStagedActive(stagedPayment) &&
      stagedPayment.tender !== "CASH" &&
      stagedPayment.amount > 0 &&
      (stagedPayment.tender !== "VOUCHER" || stagedPayment.entityId > 0);

    const payload = buildSalePayload({
      cart,
      cal,
      payments,
      stagedPayment: stagedReady ? stagedPayment : undefined,
    });

    setProcessing(true);
    try {
      const res = await createSale(payload);
      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to complete sale");
        return;
      }

      // 영수증 / drawer 용 detail 재조회 (rows + payments 포함).
      const detailRes = await getSaleInvoiceById(res.result.id);
      const detail = detailRes.ok ? detailRes.result : null;

      // Drawer 먼저 — 프린트는 수초 걸리므로 서랍을 앞세워 cashier 가 거스름돈
      // 꺼내는 동안 영수증이 뽑히게. cashIntent 기준 (cashApplied 아님) —
      // bill 0 edge 포함 현금이 손에 닿은 거래면 무조건 한 번 열림.
      if (cal.cashIntent > 0) {
        try {
          await kickDrawer();
        } catch (e) {
          console.error("kickDrawer failed:", e);
        }
      }

      // Print receipt — 거래는 이미 저장됐으므로 실패해도 flow 중단 X. 같은
      // ESC/POS 채널이라 drawer 가 끝난 뒤 직렬 전송.
      if (detail) {
        try {
          await printSaleInvoiceReceipt(detail);
        } catch (e) {
          console.error("printSaleInvoiceReceipt failed:", e);
        }
      }

      if (cal.change > 0) {
        setCompletedInfo({
          invoice: res.result,
          detail,
          total: cal.total,
          paid: cal.paid,
          cashReceived: cal.cashIntent,
          change: cal.change,
        });
      } else {
        clearActiveCart();
        onCancel();
      }
    } finally {
      setProcessing(false);
    }
  }

  // ChangeOverlay 에서 "Done" 누를 때. cart clear + modal close.
  function finishSale() {
    setCompletedInfo(null);
    clearActiveCart();
    onCancel();
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
      let detail = completedInfo.detail;
      if (!detail) {
        const res = await getSaleInvoiceById(completedInfo.invoice.id);
        if (res.ok && res.result) detail = res.result;
      }
      if (detail) await printSaleInvoiceReceipt(detail, true);
    } catch (e) {
      console.error("reprint failed:", e);
    }
  }

  // 현재 cart 를 SPEND (내부 소비) 로 저장. 결제 없이 confirm 만 받고 전송.
  // 성공 시 영수증(INTERNAL) 출력 → cart clear + modal close. drawer kick 은 안 함
  // (현금 이동 없음).
  async function handleSpend() {
    if (processing) return;
    const cart = carts[activeCartIndex];
    if (!cart || cart.lines.length === 0) return;

    const ok = window.confirm(
      "Record these items as internal consumption (SPEND)? This is not a sale.",
    );
    if (!ok) return;

    setProcessing(true);
    try {
      const payload = buildSpendPayload({ cart });
      const res = await createSpend(payload);
      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to record spend");
        return;
      }
      const detailRes = await getSaleInvoiceById(res.result.id);
      if (detailRes.ok && detailRes.result) {
        try {
          await printSaleInvoiceReceipt(detailRes.result);
        } catch (e) {
          console.error("printSaleInvoiceReceipt (SPEND) failed:", e);
        }
      }
      clearActiveCart();
      onCancel();
    } finally {
      setProcessing(false);
    }
  }

  // CASH must be the first committed tender — once any non-CASH is committed
  // the CASH button locks. Rationale: cash is the round-absorbing tender, so
  // it goes first; non-cash fills the exact remainder. Locking prevents
  // cashier from adding cash after non-cash, which would break the rounding
  // ordering. Multi-cash is fine until a non-cash committal triggers the lock.
  const cashLocked = payments.some((p) => p.tender !== "CASH");

  // Switch tender slot — discards any in-progress staged input.
  // Confirms first if there's a non-empty draft so the cashier doesn't lose
  // an entry by mis-tapping a tender button.
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

  // Commit the current staged draft into payments[]. Resets staged to a fresh
  // default of the same slot so cashier can keep adding more of the same
  // tender (e.g. multi-cash splits). For CASH, the stored amount is irrelevant
  // (will be re-derived via cashAllocations); we just snapshot cashReceived.
  //
  // VOUCHER 중복 방지는 commit 이 아니라 SELECTION 단계에서 처리한다 —
  // 이미 committed 된 voucher 는 Search modal 에서 disabled. 캐셔가 항상
  // "현재 어떤 voucher 가 쓰이고 있는지" 를 눈으로 확인하고 action 하게.
  function commitStaged() {
    if (!isStagedActive(stagedPayment)) return;
    if (stagedPayment.tender !== "CASH" && stagedPayment.amount <= 0) return;
    // VOUCHER 은 entity 선택 없이는 commit 불가 (entityId 0 = 미선택)
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

  // CASH-specific staged updater. amount is no longer stored — it's derived
  // via cashAllocations on every render. We pin it to 0 as a placeholder.
  function setStagedCashReceived(next: number) {
    setStagedPayment({
      key: "staged",
      tender: "CASH",
      cashReceived: next,
      amount: 0,
    });
  }

  // CREDIT-specific staged updater. Child sends BILL portion; parent stores
  // EFTPOS amount via the canonical eftposAmountOf helper (so display and
  // storage never disagree by 1¢ from FP rounding). Hard cap on bill.
  function setStagedCreditBillPortion(billPortion: number) {
    const cappedBill = Math.min(billPortion, left);
    setStagedPayment({
      key: "staged",
      tender: "CREDIT",
      amount: eftposAmountOf(cappedBill, credit_surcharge_rate),
    });
  }

  // GIFTCARD-specific staged updater. No surcharge — amount is keyed as-is
  // on the EFTPOS machine. Hard cap on amount (= bill).
  function setStagedGiftcardAmount(amount: number) {
    setStagedPayment({
      key: "staged",
      tender: "GIFTCARD",
      amount: Math.min(amount, left),
    });
  }

  // USER_VOUCHER: voucher 선택/발행 결과를 staged 에 반영. amount 는 0 으로
  // 초기화 — 캐셔가 numpad 로 얼마를 쓸지 정함. Balance/bill cap 은 child
  // 에서 계산.
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

  // USER_VOUCHER amount 만 갱신. entity 필드는 유지. Child 가 이미 cap 으로
  // 막았다고 가정 (min(left, voucher.balance)).
  function setStagedVoucherAmount(amount: number) {
    setStagedPayment((prev) => {
      if (prev.tender !== "VOUCHER") return prev;
      return { ...prev, amount };
    });
  }

  return (
    <div className="fixed inset-0 z-999 p-4 w-screen h-screen bg-black/50">
      {processing && <LoadingOverlay label="Processing..." />}
      {completedInfo && (
        <ChangeOverlay
          info={completedInfo}
          onKickDrawer={handleKickDrawer}
          onReprint={handleReprint}
          onClose={finishSale}
        />
      )}
      <div className="bg-white w-full h-full rounded-md flex flex-col divide-y divide-gray-300">
        <div className="h-14 flex items-center justify-between px-4">
          <h2 className="text-xl font-semibold">Payment</h2>
          <button
            type="button"
            onClick={() => onCancel()}
            className="px-4 h-9 rounded-md bg-red-500 text-white font-semibold text-sm active:bg-red-600"
          >
            Cancel
          </button>
        </div>
        <div className="flex-1 grid grid-cols-12 divide-x divide-gray-300 min-h-0">
          {/* Lines */}
          <div className="col-span-3 flex flex-col divide-y divide-gray-300 min-h-0">
            <div className="h-14 px-3 flex items-center font-medium">
              Lines ({lines.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {lines.map((li) => (
                <div
                  key={li.lineKey}
                  className="flex items-start justify-between px-3 py-2 gap-2 border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">
                      {li.name_en}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {li.name_ko}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs leading-tight">
                    <div className="text-gray-500">
                      ${fmtMoney(li.unit_price_effective)} × {fmtQty(li.qty)}
                    </div>
                    <div className="font-bold text-sm">
                      = ${fmtMoney(li.total)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Type */}
          <div className="flex flex-col gap-2 p-2">
            {PAYMENT_TYPE.map((pt, idx) => {
              const isActived = !spendMode && slotOf(stagedPayment) === pt;
              const isDisabled = spendMode || (pt === "CASH" && cashLocked);
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
            {/* SPEND toggle — 다른 tender 와 달리 mode 전환 (내부 소비 D-14~16) */}
            <button
              type="button"
              onClick={toggleSpendMode}
              className={cn(
                "border h-16 rounded-md text-sm font-bold",
                spendMode
                  ? "bg-orange-500 text-white border-orange-600"
                  : "bg-white text-orange-600 border-orange-300 active:bg-orange-50",
              )}
            >
              SPEND
            </button>
          </div>

          {/* Keypad and inputs — controlled by stagedPayment */}
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
            {stagedPayment.tender === "VOUCHER" &&
              stagedPayment.entityType === "customer-voucher" && (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  CUSTOMER VOUCHER input — TODO
                </div>
              )}
            {spendMode && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-bold uppercase tracking-widest">
                SPEND mode
              </div>
            )}
          </div>

          {/* Added Payment List — staged (top, highlighted) + committed */}
          <div className="col-span-2 flex flex-col divide-y divide-gray-300 min-h-0">
            <div className="h-14 px-3 flex items-center font-medium">
              Payments ({payments.length}
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

          {/* Summary — receipt-like breakdown + Complete Sale button */}
          <div className="col-span-3 p-3 flex flex-col gap-3 bg-gray-50">
            {/* Totals breakdown */}
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
              <SummaryRow label="TOTAL" value={cal.total} big bold />
            </section>

            {/* Payments by tender */}
            <section className="bg-white border border-gray-200 rounded-md p-3 space-y-1 text-sm">
              <div className="text-[10px] uppercase tracking-[0.15em] text-gray-500">
                Payments
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

            {/* Settlement */}
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

            {/* Complete Sale / Record Spend — spendMode 에 따라 교체 (별도 DOM) */}
            {spendMode ? (
              <button
                type="button"
                onClick={handleSpend}
                disabled={processing || lines.length === 0}
                className="mt-auto h-16 rounded-lg font-bold text-lg tracking-wide bg-orange-500 text-white active:bg-orange-600 disabled:opacity-40"
              >
                RECORD SPEND
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCompleteSale}
                disabled={completeDisabled}
                className={cn(
                  "mt-auto h-16 rounded-lg font-bold text-lg tracking-wide transition",
                  completeDisabled
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-emerald-600 text-white active:bg-emerald-700",
                )}
              >
                COMPLETE SALE
                {!completeDisabled && (
                  <span className="ml-2 text-base font-mono">
                    ${fmtMoney(cal.total)}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  // Main amount column: all tenders show bill-terms in $; a parenthetical
  // suffix carries tender-specific context (eftpos for CREDIT, Rcv for CASH).
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

// Tender 별 괄호 안 suffix. null 이면 괄호 생략.
//   CREDIT   — eftpos 키인 금액 (bill + surcharge)
//   CASH     — 받은 현금 (Rcv). 0 이면 생략
//   VOUCHER  — entityLabel 은 별도 줄에 표시 (괄호 아님)
//   GIFTCARD — 부가 정보 없음
// Sale 완료 후 change 안내 + drawer kick / reprint / close 버튼.
// change === 0 이면 이 overlay 생략 (바로 cart clear + modal close).
function ChangeOverlay({
  info,
  onKickDrawer,
  onReprint,
  onClose,
}: {
  info: {
    invoice: SaleInvoiceCreated;
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

// Summary 패널 한 줄. label ↔ value 양쪽 정렬.
//   big/bold  — TOTAL 같은 강조용
//   highlight — "warn" (REMAINING > 0) / "ok" (CHANGE > 0) 상황 색
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

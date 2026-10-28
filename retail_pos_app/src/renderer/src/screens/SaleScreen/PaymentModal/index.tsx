import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSalesStore } from "../../../store/SalesStore";
import { cn } from "../../../libs/cn";
import { useStoreSetting } from "../../../hooks/useStoreSetting";
import {
  CUSTOMER_VOUCHER_ISSUE_POINTS,
  QTY_SCALE,
} from "../../../libs/constants";
import type { PaymentQueueItem } from "./types";
import { billPortionOf } from "./usePaymentCal";
import {
  changeSlotDecision,
  createTenderState,
  fmtMoney,
  isStagedActive,
  isVoucherSlot,
  paymentTypesFor,
  removePaymentPrompt,
  selectTender,
  slotOf,
  TENDER_LABEL,
  tenderReducer,
  tenderRates,
  type TenderAction,
  type TenderSlot,
  type TenderState,
} from "../../../libs/sale/tender-queue";
import CashInput from "./CashInput";
import CreditInput from "./CreditInput";
import EftPanel from "./EftPanel";
import { useEftTender, type EftResultLine } from "./useEftTender";
import {
  activeLanePairing,
  type EftOutcome,
} from "../../../libs/eft/eft-flow";
import {
  appliedTxnIds,
  applyEftTenderAction,
  type EftTenderAction,
} from "../../../libs/eft/eft-tender";
import {
  createEftStarter,
  NOT_DURABLE_MESSAGE,
} from "../../../libs/eft/eft-start";
import type { EftPairing } from "../../../libs/eft/eft-types";
import { listEftPairings } from "../../../service/eft.service";
import {
  operationIdFor,
  pendingOperation,
  saleAttemptKey,
} from "../../../libs/operation-id";
import GiftCardInput from "./GiftCardInput";
import UserVoucherInput from "./UserVoucherInput";
import CustomerVoucherInput from "./CustomerVoucherInput";
import { Voucher } from "../../../service/voucher.service";
import {
  CustomerVoucher,
  getValidCustomerVouchers,
} from "../../../service/customer-voucher.service";
import {
  memberVoucherIndicators,
  voucherListStateFromAnswer,
  type VoucherListState,
} from "../../../libs/customer-voucher-list";
import {
  createSpend,
  getSaleInvoiceById,
  OrderCollectResult,
  postSale,
  SaleInvoiceCreated,
  SaleInvoiceDetail,
} from "../../../service/sale.service";
import {
  SALE_MESSAGES,
  submitSale,
  submitSpend,
  type CompletedSaleInfo,
} from "../../../libs/sale/submit-sale";
import { getMemberLevelOneEstimate } from "../../../libs/sale/member-level-estimate";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { kickDrawer } from "../../../libs/printer/kick-drawer";
import { printSaleInvoiceReceipt } from "../../../libs/printer/sale-invoice-receipt";
import TapTarget from "./TapTarget";
import {
  getDominantPaymentCategory,
  PAYMENT_CATEGORY_CLASSES,
} from "../../../libs/payment-colors";

// Tender slots, labels, default drafts and the reducer live in
// libs/sale/tender-queue.ts (pure, shared with Runner — T-1). An approved
// integrated card payment joins the queue through libs/eft/eft-tender.ts
// (retail-eftpos T-7) — a wrapper, so the shared reducer is untouched.
type TenderStateVM = TenderState<Voucher, CustomerVoucher>;
const reducer = (
  state: TenderStateVM,
  action: TenderAction<Voucher, CustomerVoucher> | EftTenderAction,
): TenderStateVM =>
  action.type === "eft-approved" || action.type === "eft-clear-credit-draft"
    ? applyEftTenderAction(state, action)
    : tenderReducer(state, action);
const initTenderState = (): TenderStateVM =>
  createTenderState<Voucher, CustomerVoucher>();

// qty (×QTY_SCALE) → display string. 정수면 그대로, 소수 weight 면 뒤 0 제거.
const fmtQty = (q: number) => {
  const v = q / QTY_SCALE;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
};

export default function PaymentModal({ onCancel }: { onCancel: () => void }) {
  const { storeSetting } = useStoreSetting();
  // Tender state — pure reducer (libs/sale/tender-queue). Staged draft,
  // committed queue, staged Staff/Customer Voucher objects and SPEND mode.
  // SPEND 토글 모드 — ON 이면 tender picker 비활성 + keypad 영역 overlay,
  // Summary 의 COMPLETE 자리에 RECORD SPEND 버튼. 토글 시 전부 리셋.
  const [tender, dispatch] = useReducer(reducer, undefined, initTenderState);
  const {
    staged: stagedPayment,
    payments,
    stagedVoucher,
    stagedCustomerVoucher,
    customerVoucherMemberPoints,
    spendMode,
  } = tender;

  function toggleSpendMode() {
    dispatch({ type: "toggle-spend" });
  }
  const { carts, activeCartIndex, clearActiveCart, setMember } =
    useSalesStore();
  const lines = useMemo(
    () => carts[activeCartIndex]?.lines ?? [],
    [carts, activeCartIndex],
  );

  // 15: 1.5%, 150:15%, 1500:150% — fallbacks in tenderRates.
  const rates = useMemo(() => tenderRates(storeSetting), [storeSetting]);
  const credit_surcharge_rate = rates.creditSurchargeRate;
  const activeMember = carts[activeCartIndex]?.member ?? null;
  const memberLevelEstimate = useMemo(
    () => getMemberLevelOneEstimate({ lines, member: activeMember }),
    [lines, activeMember],
  );
  const activeMemberId = activeMember?.id ?? null;
  // T-25 (V-10): "Voucher available" = the member owns spendable voucher
  // balance (read from CRM); points → voucher exchange readiness is a
  // separate indicator. A failed read shows "unknown", never "available".
  const [memberVoucherState, setMemberVoucherState] = useState<VoucherListState>({
    kind: "loading",
  });
  const voucherIndicators = memberVoucherIndicators({
    state: memberVoucherState,
    points: customerVoucherMemberPoints ?? activeMember?.points ?? null,
    issuePoints: CUSTOMER_VOUCHER_ISSUE_POINTS,
  });
  const hasAvailableCustomerVoucher = voucherIndicators.voucherBadge === "available";
  const previousMemberIdRef = useRef<string | null>(activeMemberId);
  const paymentTypes = paymentTypesFor(activeMember != null);

  useEffect(() => {
    if (!activeMemberId) return;
    let ignore = false;
    setMemberVoucherState({ kind: "loading" });
    getValidCustomerVouchers(activeMemberId)
      .catch(() => null)
      .then((answer) => {
        if (!ignore) setMemberVoucherState(voucherListStateFromAnswer(answer, new Date()));
      });
    return () => {
      ignore = true;
    };
    // customerVoucherMemberPoints changes after a points → voucher exchange.
  }, [activeMemberId, customerVoucherMemberPoints]);

  useEffect(() => {
    if (previousMemberIdRef.current === activeMemberId) return;
    previousMemberIdRef.current = activeMemberId;
    dispatch({ type: "member-changed" });
  }, [activeMemberId]);

  // Everything derived from the tender state: cal (usePaymentCal math —
  // rounding, surcharge, remaining, change, points), input cap `left`, EXACT
  // cash, display list with cash FIFO allocation, per-slot sums, locks.
  const hasMember = activeMember != null;
  const {
    cal,
    left,
    exactCashAmount,
    derivedPayments,
    tenderSums,
    usedUserVoucherIds,
    usedCustomerVoucherIds,
    voucherLocked,
    cashLocked,
    completeDisabled,
  } = useMemo(
    () =>
      selectTender(
        { staged: stagedPayment, payments },
        { lines, rates, hasMember },
      ),
    [stagedPayment, payments, lines, rates, hasMember],
  );

  // ── Integrated EFTPOS (retail-eftpos T-7, D-2..D-5) ──────────────────────
  // CREDIT is integrated only when this lane has a selected, active pairing
  // (S-3 A-1); otherwise — no pairing, an older store server, 503 "EFT is not
  // configured" — it stays the keyed external-EFTPOS tender, unchanged.
  const [lanePairing, setLanePairing] = useState<EftPairing | null>(null);
  const [eftOff, setEftOff] = useState(false);
  const [eftResult, setEftResult] = useState<EftResultLine>(null);
  // payment key → EFT transaction id: one approved row is applied once.
  const eftKeysRef = useRef(new Map<string, string>());
  useEffect(() => {
    let ignore = false;
    listEftPairings()
      .then((res) => {
        if (!ignore && res.ok) setLanePairing(activeLanePairing(res.result));
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);
  const terminalLabel = lanePairing
    ? `SCI · ${lanePairing.nickname || lanePairing.terminalNickname || lanePairing.tid || lanePairing.pairingId}`
    : "";

  function handleEftOutcome(outcome: EftOutcome, state: { unavailable: boolean }) {
    eft.close();
    if (outcome.kind === "paid") {
      const key = crypto.randomUUID();
      eftKeysRef.current.set(key, outcome.txnId);
      dispatch({ type: "eft-approved", key, amountCents: outcome.amountCents });
      setEftResult({
        tone: "ok",
        text: outcome.viaOverride
          ? `Recorded as paid (manual confirmation) $${fmtMoney(outcome.amountCents)}`
          : `Card approved $${fmtMoney(outcome.amountCents)}`,
      });
      return;
    }
    // A-28 (F-12): declined / cancelled / override No / approved-but-different
    // / not sent — the keyed CREDIT draft is dropped; COMPLETE cannot record
    // it, a manual card payment needs a fresh re-key.
    dispatch({ type: "eft-clear-credit-draft" });
    if (state.unavailable) setEftOff(true);
    setEftResult({
      tone: "error",
      text:
        outcome.kind === "review"
          ? `${outcome.message}. Check the terminal receipt, then key the card payment manually.`
          : outcome.message,
    });
  }
  const eft = useEftTender(handleEftOutcome);
  const eftTerminalActive = !!lanePairing && !eftOff;

  // A-29 (F-14): the create goes out only with a durably stored sale attempt
  // id; one start at a time; a start left behind by Cancel never sends.
  const [eftStarter] = useState(() =>
    createEftStarter({
      mint: (key) => operationIdFor(key),
      persist: async () => undefined, // localStorage writes are synchronous; the read-back proves them
      stored: (key) => pendingOperation(key)?.operationId ?? null,
    }),
  );
  useEffect(() => () => eftStarter.cancel(), [eftStarter]);

  async function startTerminalPayment() {
    if (eft.running || eftStarter.isStarting()) return;
    if (stagedPayment.tender !== "CREDIT" || stagedPayment.amount <= 0) return;
    setEftResult(null);
    const amountCents = stagedPayment.amount;
    const cartIndex = activeCartIndex;
    const applied = appliedTxnIds(payments, eftKeysRef.current);
    // The sale attempt's id (kept across a restart until the sale is
    // recorded): the same create answers the same row — no double charge.
    const result = await eftStarter.start(
      saleAttemptKey(cartIndex),
      () => useSalesStore.getState().activeCartIndex === cartIndex,
      (operationId) => eft.start({ operationId, amountCents, appliedTxnIds: applied }),
    );
    if (result === "not-durable") setEftResult({ tone: "error", text: NOT_DURABLE_MESSAGE });
  }

  function handleCancelModal() {
    if (
      eft.running &&
      !window.confirm(
        "A card payment is still running on the terminal. Close the payment screen anyway?",
      )
    )
      return;
    eftStarter.cancel();
    onCancel();
  }

  // CREDIT staged needs clamping when `left` shrinks (e.g. another committed
  // payment grows the non-cash bill, or cash absorbs more).
  useEffect(() => {
    dispatch({
      type: "clamp-credit",
      left,
      surchargeRate: credit_surcharge_rate,
    });
  }, [left, credit_surcharge_rate]);

  const completePaymentCategory = useMemo(
    () =>
      getDominantPaymentCategory({
        cash: tenderSums.get("CASH") ?? 0,
        credit: tenderSums.get("CREDIT") ?? 0,
        others:
          (tenderSums.get("USER_VOUCHER") ?? 0) +
          (tenderSums.get("CUSTOMER_VOUCHER") ?? 0) +
          (tenderSums.get("GIFTCARD") ?? 0),
      }),
    [tenderSums],
  );


  // Completion flow state:
  //   processing     — submitSale 요청 중. LoadingOverlay 로 유저 행동 블락.
  //   completedInfo  — sale 저장 후 snapshot. ChangeOverlay 에서 receipt print
  //                    여부를 cashier 가 선택. close → cart clear + modal 종료.
  const [processing, setProcessing] = useState(false);
  const [completedInfo, setCompletedInfo] = useState<
    | (CompletedSaleInfo<SaleInvoiceCreated> & {
        detail: SaleInvoiceDetail | null; // reprint 때 재조회 없이 바로 사용
      })
    | null
  >(null);

  async function handleCompleteSale() {
    if (completeDisabled || processing) return;
    // Manual escape hatch (T-7): COMPLETE stays available while a terminal
    // payment runs — the keyed CREDIT draft is recorded as today.
    if (
      eft.running &&
      !window.confirm(
        "A card payment is still running on the terminal. Complete the sale with the keyed amount as a manual card payment?",
      )
    )
      return;
    const cart = carts[activeCartIndex];
    if (!cart) return;

    // libs/sale/submit-sale: cart snapshot → payload (a ready non-cash staged
    // draft is included — 1-step Complete) → operationId attempt → answer.
    setProcessing(true);
    try {
      const outcome = await submitSale(
        {
          cart,
          cartIndex: activeCartIndex,
          cal,
          payments,
          stagedPayment,
        },
        postSale,
      );
      if (!outcome.ok) {
        window.alert(outcome.message);
        return;
      }
      // T-15 — a retry after a lost response: the server already had this
      // sale and returns the same invoice instead of charging again.
      if (outcome.replayNotice) {
        window.alert(outcome.replayNotice);
      }

      // S3 — 주문 로드 카트면 collect 결과 노출 (pending = 스윕 자동
      // 재시도, conflict = 영구 실패 — 사람 확인) — completed.order.
      setCompletedInfo({ ...outcome.completed, detail: null });
      clearActiveCart();

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

      // 영수증 용 detail 재조회 (rows + payments 포함). 실패해도 거래와 cart
      // clear 는 이미 확정됐고, Print Receipt 에서 다시 조회할 수 있다.
      const invoiceId = outcome.invoice.id;
      const detailRes = await getSaleInvoiceById(invoiceId);
      const detail = detailRes.ok ? detailRes.result : null;
      if (detail) {
        setCompletedInfo((prev) =>
          prev && prev.invoice.id === invoiceId ? { ...prev, detail } : prev,
        );
      }
    } finally {
      setProcessing(false);
    }
  }

  // ChangeOverlay 에서 "Done" 누를 때. cart 는 저장 성공 시 이미 clear 됐고,
  // 여기서는 completion UI 만 닫는다.
  function finishSale() {
    setCompletedInfo(null);
    onCancel();
  }

  async function handleKickDrawer() {
    try {
      await kickDrawer();
    } catch (e) {
      console.error("kickDrawer failed:", e);
    }
  }

  async function handlePrintReceipt() {
    if (!completedInfo) return;
    try {
      let detail = completedInfo.detail;
      if (!detail) {
        const res = await getSaleInvoiceById(completedInfo.invoice.id);
        if (res.ok && res.result) detail = res.result;
      }
      if (!detail) {
        window.alert("Failed to load receipt detail");
        return;
      }
      // 멤버 판매면 합산 포인트(잔액 스냅샷 + 서버 확정 적립) 한 줄 추가.
      const memberTotalPoints =
        completedInfo.memberPointsBefore != null && detail.type === "SALE"
          ? completedInfo.memberPointsBefore + detail.pointsEarned
          : undefined;
      await printSaleInvoiceReceipt(
        detail,
        completedInfo.receiptPrinted,
        storeSetting?.receipt_below_text || undefined,
        storeSetting?.receipt_extra_footer_text || undefined,
        memberTotalPoints,
      );
      setCompletedInfo((prev) =>
        prev ? { ...prev, detail, receiptPrinted: true } : prev,
      );
    } catch (e) {
      console.error("print receipt failed:", e);
    }
  }

  // 현재 cart 를 SPEND (내부 소비) 로 저장. 결제 없이 confirm 만 받고 전송.
  // 성공 시 영수증(INTERNAL) 출력 → cart clear + modal close. drawer kick 은 안 함
  // (현금 이동 없음).
  async function handleSpend() {
    if (processing) return;
    const cart = carts[activeCartIndex];
    if (!cart || cart.lines.length === 0) return;

    const ok = window.confirm(SALE_MESSAGES.spendConfirm);
    if (!ok) return;

    setProcessing(true);
    try {
      const outcome = await submitSpend({ cart, cartIndex: activeCartIndex }, createSpend);
      if (!outcome.ok) {
        window.alert(outcome.message);
        return;
      }
      const detailRes = await getSaleInvoiceById(outcome.invoice.id);
      if (detailRes.ok && detailRes.result) {
        try {
          await printSaleInvoiceReceipt(
            detailRes.result,
            false,
            storeSetting?.receipt_below_text || undefined,
            storeSetting?.receipt_extra_footer_text || undefined,
          );
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

  // Switch tender slot — discards any in-progress staged input. Confirms
  // first if there's a non-empty draft so the cashier doesn't lose an entry
  // by mis-tapping a tender button. Locks: changeSlotDecision.
  function changeSlot(slot: TenderSlot) {
    if (eft.running) return;
    const decision = changeSlotDecision(tender, slot);
    if (decision.kind === "ignore") return;
    if (decision.kind === "confirm" && !window.confirm(decision.message)) {
      return;
    }
    dispatch({ type: "change-slot", slot });
  }

  // Commit the current staged draft into payments[] (guards in the reducer).
  function commitStaged() {
    dispatch({ type: "commit-staged", key: crypto.randomUUID() });
  }

  function handleRemovePayment(key: string) {
    const message = removePaymentPrompt(payments, key);
    if (!message) return;
    if (!window.confirm(message)) return;
    dispatch({ type: "remove-payment", key });
  }

  function setStagedCashReceived(next: number) {
    dispatch({ type: "set-cash-received", cashReceived: next });
  }

  // Child sends the BILL portion; capped at `left`, stored as EFTPOS amount.
  function setStagedCreditBillPortion(billPortion: number) {
    dispatch({
      type: "set-credit-bill",
      billPortion,
      left,
      surchargeRate: credit_surcharge_rate,
    });
  }

  function setStagedGiftcardAmount(amount: number) {
    dispatch({ type: "set-giftcard-amount", amount, left });
  }

  function selectUserVoucher(
    user: { id: number; name: string },
    voucher: Voucher,
  ) {
    dispatch({ type: "select-user-voucher", user, voucher });
  }

  // Child already caps at min(left, voucher.balance).
  function setStagedVoucherAmount(amount: number) {
    dispatch({ type: "set-user-voucher-amount", amount });
  }

  // F-17 (T-17): the member's points after a points→voucher exchange answer
  // (fresh or replayed), reported by the modal whether or not a voucher is
  // then selected — keeps ISSUE gating and memberPointsBefore on the receipt
  // at the post-exchange balance.
  function updateCustomerVoucherMemberPoints(memberPoints: number) {
    dispatch({ type: "set-customer-voucher-member-points", memberPoints });
    if (activeMember) {
      setMember({ ...activeMember, points: memberPoints });
    }
  }

  function selectCustomerVoucher(voucher: CustomerVoucher) {
    dispatch({ type: "select-customer-voucher", voucher });
  }

  function setStagedCustomerVoucherAmount(amount: number) {
    dispatch({ type: "set-customer-voucher-amount", amount });
  }

  return (
    <div className="fixed inset-0 z-999 p-4 w-screen h-screen bg-black/50">
      {processing && <LoadingOverlay label="Processing..." />}
      {completedInfo && (
        <ChangeOverlay
          info={completedInfo}
          onKickDrawer={handleKickDrawer}
          onPrintReceipt={handlePrintReceipt}
          onClose={finishSale}
        />
      )}
      <div className="bg-white w-full h-full rounded-md flex flex-col divide-y divide-gray-300">
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Payment</h2>
            {activeMember && (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
                  hasAvailableCustomerVoucher
                    ? "animate-bounce bg-red-500 text-white"
                    : "bg-emerald-100 text-emerald-700",
                )}
              >
                {hasAvailableCustomerVoucher
                  ? `Voucher available $${fmtMoney(voucherIndicators.ownedBalance ?? 0)}`
                  : "Member"}
              </span>
            )}
            {activeMember && memberVoucherState.kind === "unavailable" && (
              <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-800">
                Vouchers: CRM unavailable
              </span>
            )}
            {activeMember && voucherIndicators.exchangeReady && (
              <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                Points → voucher ready
              </span>
            )}
            {activeMember && !spendMode && (
              // 잔액 → 합산(예상 적립 포함). cashier 가 영수증 전에 안내할 수
              // 있게 헤더에 상시 노출. 적립 예상은 결제 수단 조합에 따라 변동.
              <span className="text-sm font-semibold text-gray-600">
                {activeMember.points != null ? (
                  <>
                    P {activeMember.points.toLocaleString()}
                    {cal.pointsEarned > 0 &&
                      ` → ${(activeMember.points + cal.pointsEarned).toLocaleString()}`}
                  </>
                ) : (
                  // 오프라인 미검증 멤버 — CRM 잔액을 모른다. 예상 적립만 노출.
                  <>
                    Offline
                    {cal.pointsEarned > 0 &&
                      ` · +${cal.pointsEarned.toLocaleString()}P pending`}
                  </>
                )}
              </span>
            )}
          </div>
          <TapTarget
            onClick={handleCancelModal}
            className="px-4 h-9 rounded-md bg-red-500 text-white font-semibold text-sm active:bg-red-600 flex items-center justify-center"
          >
            Cancel
          </TapTarget>
        </div>
        <div className="flex-1 grid grid-cols-12 divide-x divide-gray-300 min-h-0">
          {/* Lines */}
          <div className="col-span-3 flex flex-col divide-y divide-gray-300 min-h-0">
            <div className="h-14 px-3 flex items-center font-medium">
              Lines ({lines.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {lines.map((li) => {
                const { unit_price_effective, unit_price_original } = li;
                // how much discount in percentage
                const discountPercentage =
                  unit_price_original === 0
                    ? 0
                    : Math.max(
                        0,
                        ((unit_price_original - unit_price_effective) /
                          unit_price_original) *
                          100,
                      );

                const discountText =
                  discountPercentage > 0
                    ? `${discountPercentage.toFixed(0)}%`
                    : "";

                return (
                  <div
                    key={li.lineKey}
                    className="flex items-start justify-between px-3 py-2 gap-2 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-xs">
                        {li.name_ko}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {li.name_en}
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-xs leading-tight">
                      <div className="text-gray-500">
                        ${fmtMoney(li.unit_price_effective)} × {fmtQty(li.qty)}
                      </div>
                      <div className="font-bold text-sm">
                        {`$${fmtMoney(li.total)}`}
                        {discountText && (
                          <span className="text-red-500">{`(${discountText})`}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment Type */}
          <div className="flex flex-col gap-2 p-2">
            {paymentTypes.map((pt, idx) => {
              const isActived = !spendMode && slotOf(stagedPayment) === pt;
              const isDisabled =
                spendMode ||
                eft.running ||
                (isVoucherSlot(pt) && voucherLocked) ||
                (pt === "CASH" && cashLocked);
              const strs = pt.split("_");
              return (
                <TapTarget
                  key={`pt_${idx}`}
                  onClick={() => changeSlot(pt)}
                  disabled={isDisabled}
                  className={cn(
                    "border border-gray-300 h-16 rounded-md text-sm flex flex-col items-center justify-center",
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
                </TapTarget>
              );
            })}
            {/* SPEND toggle — 다른 tender 와 달리 mode 전환 (내부 소비 D-14~16) */}
            <TapTarget
              onClick={toggleSpendMode}
              disabled={eft.running}
              className={cn(
                "border h-16 rounded-md text-sm font-bold flex items-center justify-center",
                spendMode
                  ? "bg-orange-500 text-white border-orange-600"
                  : "bg-white text-orange-600 border-orange-300 active:bg-orange-50",
              )}
            >
              SPEND
            </TapTarget>
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
            {eft.state.phase !== "idle" && (
              <EftPanel eft={eft} terminalLabel={terminalLabel} />
            )}
            {eft.state.phase === "idle" && stagedPayment.tender === "CREDIT" && (
              <CreditInput
                billPortion={billPortionOf(
                  stagedPayment,
                  credit_surcharge_rate,
                )}
                setBillPortion={setStagedCreditBillPortion}
                left={left}
                surchargeRate={credit_surcharge_rate}
                onCommit={commitStaged}
                terminal={
                  eftTerminalActive
                    ? { label: terminalLabel, onPay: () => void startTerminalPayment() }
                    : null
                }
                resultLine={
                  eftResult ??
                  (eft.printNotice ? { tone: "error", text: eft.printNotice } : null)
                }
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
              stagedPayment.entityType === "customer-voucher" &&
              activeMemberId && (
                <CustomerVoucherInput
                  amount={stagedPayment.amount}
                  setAmount={setStagedCustomerVoucherAmount}
                  left={left}
                  voucher={stagedCustomerVoucher}
                  memberId={activeMemberId}
                  memberPoints={
                    customerVoucherMemberPoints ?? activeMember?.points ?? 0
                  }
                  usedVoucherIds={usedCustomerVoucherIds}
                  onSelectVoucher={selectCustomerVoucher}
                  onMemberPoints={updateCustomerVoucherMemberPoints}
                  onCommit={commitStaged}
                />
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
              {Array.from(tenderSums.entries()).filter(([, amt]) => amt > 0)
                .length === 0 ? (
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
              {cal.pointsEarned > 0 && !spendMode && !completeDisabled && (
                <div className="flex items-center justify-between text-sm text-emerald-700 font-bold">
                  <span>Expected Points Earned</span>
                  <span>{cal.pointsEarned.toLocaleString()}</span>
                </div>
              )}
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
            <div className="mt-auto flex flex-col gap-2">
              {!spendMode && memberLevelEstimate && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Member total approx
                  </div>
                  <div className="font-mono text-sm font-bold text-emerald-800">
                    ${fmtMoney(memberLevelEstimate.memberTotal)}
                    <span className="ml-1 text-xs font-semibold">
                      (SAVE ${fmtMoney(memberLevelEstimate.savings)})
                    </span>
                  </div>
                </div>
              )}

              {spendMode ? (
                <TapTarget
                  onClick={handleSpend}
                  disabled={processing || lines.length === 0}
                  className={cn(
                    "h-16 rounded-lg font-bold text-lg tracking-wide text-white flex items-center justify-center",
                    processing || lines.length === 0
                      ? "bg-orange-300 opacity-40 cursor-not-allowed"
                      : "bg-orange-500 active:bg-orange-600",
                  )}
                >
                  RECORD SPEND
                </TapTarget>
              ) : (
                <TapTarget
                  onClick={handleCompleteSale}
                  disabled={completeDisabled}
                  className={cn(
                    "h-16 rounded-lg font-bold text-sm tracking-wide transition",
                    completeDisabled
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed flex items-center justify-center"
                      : cn(
                          "flex items-center justify-center",
                          completePaymentCategory
                            ? PAYMENT_CATEGORY_CLASSES[completePaymentCategory]
                                .button
                            : PAYMENT_CATEGORY_CLASSES.cash.button,
                        ),
                  )}
                >
                  COMPLETE
                  {!completeDisabled && (
                    <span className="ml-2 text-2xl font-mono">
                      ${fmtMoney(cal.total)}
                    </span>
                  )}
                </TapTarget>
              )}
            </div>
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
          <div className="font-mono text-sm  break-words">({suffix})</div>
        )}
        {item.tender === "VOUCHER" && item.entityLabel && (
          <div className="text-xs text-gray-500 truncate">
            {item.entityLabel}
          </div>
        )}
      </div>
      {onRemove ? (
        <TapTarget
          onClick={onRemove}
          className="self-stretch w-10 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 active:bg-gray-200 text-base shrink-0"
        >
          ✕
        </TapTarget>
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
  onPrintReceipt,
  onClose,
}: {
  info: {
    invoice: SaleInvoiceCreated;
    total: number;
    paid: number;
    cashReceived: number;
    change: number;
    receiptPrinted: boolean;
    order: { orderNo: string; collectResult: OrderCollectResult } | null;
  };
  onKickDrawer: () => void;
  onPrintReceipt: () => void;
  onClose: () => void;
}) {
  const hasChange = info.change > 0;
  const hasCash = info.cashReceived > 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-6"
      style={{ zIndex: 9998 }}
    >
      <div className="bg-white rounded-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-gray-500">
            {hasChange ? "Change Due" : "Sale Complete"}
          </div>
          <div
            className={cn(
              "font-bold text-emerald-600 font-mono mt-1",
              hasChange ? "text-5xl" : "text-3xl",
            )}
          >
            {hasChange ? `$${fmtMoney(info.change)}` : "Receipt?"}
          </div>
        </div>
        <div className="bg-gray-50 rounded p-3 space-y-1 font-mono text-sm">
          <div className="flex justify-between">
            <span>TOTAL</span>
            <span>${fmtMoney(info.total)}</span>
          </div>
          {hasCash && (
            <div className="flex justify-between">
              <span>CASH RCVD</span>
              <span>${fmtMoney(info.cashReceived)}</span>
            </div>
          )}
          {info.receiptPrinted && (
            <div className="flex justify-between text-emerald-700">
              <span>RECEIPT</span>
              <span>PRINTED</span>
            </div>
          )}
          {/* S3 — 주문 로드 판매의 collect 결과. pending 은 스윕 자동 재시도,
              conflict 는 영구 실패 — 재시도 없음, Orders 화면에서 사람 확인. */}
          {info.order && (
            <div
              className={cn(
                "font-bold",
                info.order.collectResult === "collected"
                  ? "text-emerald-700"
                  : info.order.collectResult === "conflict"
                    ? "text-red-600"
                    : "text-amber-600",
              )}
            >
              <div className="flex justify-between">
                <span>ORDER #{info.order.orderNo}</span>
                <span>
                  {info.order.collectResult === "collected"
                    ? "COLLECTED"
                    : info.order.collectResult === "conflict"
                      ? "NOT COLLECTED"
                      : "PENDING (AUTO RETRY)"}
                </span>
              </div>
              {info.order.collectResult === "conflict" && (
                <div className="mt-1 rounded border border-red-400 bg-red-50 p-2">
                  ORDER CONFLICT — NOT COLLECTED. Check the order in Orders
                  screen.
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {hasCash && (
            <TapTarget
              onClick={onKickDrawer}
              className="flex-1 h-12 rounded-md bg-blue-600 text-white font-bold text-sm active:bg-blue-700 flex items-center justify-center"
            >
              Open Drawer
            </TapTarget>
          )}
          <TapTarget
            onClick={onPrintReceipt}
            className="flex-1 h-12 rounded-md bg-gray-200 text-gray-800 font-bold text-sm active:bg-gray-300 flex items-center justify-center"
          >
            {info.receiptPrinted ? "Reprint" : "Print Receipt"}
          </TapTarget>
        </div>
        <TapTarget
          onClick={onClose}
          className="h-14 rounded-md bg-emerald-600 text-white font-bold text-lg active:bg-emerald-700 flex items-center justify-center"
        >
          Done
        </TapTarget>
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

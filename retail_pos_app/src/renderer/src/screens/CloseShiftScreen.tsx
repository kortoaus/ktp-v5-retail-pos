import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CashCounter from "../components/CashCounter";
import KeyboardInputText from "../components/KeyboardInputText";
import BlockScreen from "../components/BlockScreen";
import { useShift } from "../contexts/ShiftContext";
import {
  getClosingShiftData,
  getShiftById,
  type ClosingShiftData,
} from "../service/shift.service";
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";
import { printShiftSettlementReceipt } from "../libs/printer/shift-settlement-receipt";
import {
  SHIFT_LOAD_FAILED_MESSAGE,
  SHIFT_RELOAD_FAILED_MESSAGE,
  closeShiftView,
  type ClosePreviewState,
} from "../libs/shift-close";
import type { TerminalShift } from "../types/models";
import {
  CUSTOMER_VOUCHER_LABEL,
  RECONCILIATION_HEADER,
  STAFF_VOUCHER_LABEL,
  reconciliationRows,
  settlementTotals,
} from "../libs/printer/shift-settlement-lines";

const fmt = (cents: number) => `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const signedFmt = (cents: number) => {
  if (cents === 0) return fmt(0);
  return (cents > 0 ? "+" : "-") + fmt(cents);
};
const netFmt = (cents: number) => (cents < 0 ? `-${fmt(cents)}` : fmt(cents));

interface ReadyBodyProps {
  shift: TerminalShift;
  closingData: ClosingShiftData;
  cashActualCents: number;
  cashActual: number;
  setCashActual: (value: number) => void;
  note: string;
  setNote: (value: string) => void;
  countGeneration: number;
}

// The closing preview + cash count (unchanged content; split out in T-10
// review round 3 so the header and the stale banner never wait for it).
function ReadyBody({
  shift,
  closingData,
  cashActualCents,
  cashActual,
  setCashActual,
  note,
  setNote,
  countGeneration,
}: ReadyBodyProps) {
  const { aggregate, endedCashExpected } = closingData;
  const openVoucherOps = closingData.customerVoucherOpenOperations ?? 0;
  const startedCash = shift.startedCash;
  const difference = cashActualCents - endedCashExpected;

  // Voucher 는 user / customer 분리 저장 (D-20). T-25 (V-11): UI 도 분리 표시
  // (Staff Voucher = 직원 바우처, Customer Voucher = CRM). 합계는 그대로.
  const { netStaffVoucher, netCustomerVoucher } = settlementTotals(aggregate);
  const netCredit = aggregate.salesCredit - aggregate.refundsCredit;
  const netGiftcard = aggregate.salesGiftcard - aggregate.refundsGiftcard;
  const crmRows = reconciliationRows(closingData.customerVoucherReconciliation);

  const tenderSummaryRows: [string, string][] = [
    ["Cash Drawer", fmt(endedCashExpected)],
    ["Card Terminal", netFmt(netCredit)],
    [STAFF_VOUCHER_LABEL, netFmt(netStaffVoucher)],
    [CUSTOMER_VOUCHER_LABEL, netFmt(netCustomerVoucher)],
    ["Gift Card", netFmt(netGiftcard)],
  ];

  // 한 줄 단위 요약. 값이 0 이어도 주요 항목은 표시 (상태가 정확히 보이도록).
  const summaryRows: [string, string][] = [
    ["Started Cash", fmt(startedCash)],
    [`Sales (${aggregate.salesCount})`, ""],
    ["  Cash", fmt(aggregate.salesCash)],
    ["  Credit", fmt(aggregate.salesCredit)],
    [`  ${STAFF_VOUCHER_LABEL}`, fmt(aggregate.salesUserVoucher)],
    [`  ${CUSTOMER_VOUCHER_LABEL}`, fmt(aggregate.salesCustomerVoucher)],
    ["  Gift Card", fmt(aggregate.salesGiftcard)],
    ["  GST", fmt(aggregate.salesTax)],
    ...(aggregate.repayCount > 0
      ? ([[`  (repaid: ${aggregate.repayCount})`, ""]] as [string, string][])
      : []),
    [`Refunds (${aggregate.refundsCount})`, ""],
    ["  Cash", `-${fmt(aggregate.refundsCash)}`],
    ["  Credit", `-${fmt(aggregate.refundsCredit)}`],
    [`  ${STAFF_VOUCHER_LABEL}`, `-${fmt(aggregate.refundsUserVoucher)}`],
    [`  ${CUSTOMER_VOUCHER_LABEL}`, `-${fmt(aggregate.refundsCustomerVoucher)}`],
    ["  Gift Card", `-${fmt(aggregate.refundsGiftcard)}`],
    ["  GST", `-${fmt(aggregate.refundsTax)}`],
    ["Cash In", fmt(aggregate.totalCashIn)],
    ["Cash Out", `-${fmt(aggregate.totalCashOut)}`],
    ...(aggregate.spendCount > 0
      ? ([
          [`Spend (${aggregate.spendCount})`, ""],
          ["  Retail value", fmt(aggregate.spendRetailValue)],
        ] as [string, string][])
      : []),
    ...(crmRows
      ? ([
          [RECONCILIATION_HEADER, ""],
          ...crmRows.map(([label, value]) => [`  ${label}`, value]),
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Summary */}
      <div className="w-[340px] border-r border-gray-200 p-4 flex flex-col">
        {openVoucherOps !== 0 && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {openVoucherOps > 0
              ? `${openVoucherOps} customer voucher payment${openVoucherOps === 1 ? " is" : "s are"} still being checked with CRM`
              : "Customer voucher checks could not be read"}
          </div>
        )}
        <h3 className="text-sm font-bold mb-3">Tender Summary</h3>
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2 text-base">
          {tenderSummaryRows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span className="text-gray-600">{label}</span>
              <span className="font-bold font-mono">{value}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-bold mb-3">Shift Summary</h3>
        <div className="min-h-0 flex-1 flex flex-col gap-1 text-base overflow-y-auto">
          {summaryRows.map(([label, value], idx) => (
            <div
              key={`${label}-${idx}`}
              className="flex justify-between py-0.5"
            >
              <span className="text-gray-500">{label}</span>
              <span className="font-medium font-mono">{value}</span>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-gray-200 flex flex-col gap-1">
          <div className="flex justify-between text-lg font-bold">
            <span>Expected</span>
            <span className="font-mono">{fmt(endedCashExpected)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>Actual</span>
            <span className="font-mono">{fmt(cashActualCents)}</span>
          </div>
          <div
            className={`flex justify-between text-lg font-bold ${
              difference === 0
                ? "text-green-600"
                : difference > 0
                  ? "text-blue-600"
                  : "text-red-600"
            }`}
          >
            <span>Difference</span>
            <span className="font-mono">{signedFmt(difference)}</span>
          </div>
        </div>

        <div className="pt-3">
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            Note
          </label>
          <KeyboardInputText
            value={note}
            onChange={setNote}
            placeholder="Closing note..."
            initialLayout="english"
          />
        </div>
      </div>

      {/* Cash Counter */}
      <div className="flex-1 p-4">
        <CashCounter
          key={`${shift.id}:${countGeneration}`}
          value={cashActual}
          onChange={setCashActual}
        />
      </div>
    </div>
  );
}

export default function CloseShiftScreen() {
  const navigate = useNavigate();
  const { shift, closeShift, staleShiftId, shiftKnown, retryShiftReload } =
    useShift();
  const [retrying, setRetrying] = useState(false);
  const [cashActual, setCashActual] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [closingData, setClosingData] = useState<ClosingShiftData | null>(null);
  const [preview, setPreview] = useState<ClosePreviewState>("loading");
  const [previewMsg, setPreviewMsg] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  // Bumped to remount CashCounter (it keeps its own denomination counts).
  const [countGeneration, setCountGeneration] = useState(0);

  // A failed preview (e.g. no shift open on the server) is shown as such —
  // never an endless "Loading" (T-10 review round 3).
  const fetchData = useCallback(async () => {
    setPreview("loading");
    try {
      const res = await getClosingShiftData();
      if (res.ok && res.result) {
        setClosingData(res.result);
        setPreview("ready");
      } else {
        setPreviewMsg(res.msg || "");
        setPreview("failed");
      }
    } catch {
      setPreviewMsg("");
      setPreview("failed");
    }
  }, []);

  useEffect(() => {
    if (shift) fetchData();
  }, [shift, fetchData]);

  // T-10 review — known-stale shift: re-read it from the server (in place;
  // the screen stays mounted).
  const handleRetryReload = useCallback(async () => {
    setRetrying(true);
    try {
      await retryShiftReload();
    } finally {
      setRetrying(false);
    }
  }, [retryShiftReload]);

  // Entering the screen while stale or unknown (e.g. Home, then back) retries
  // once, so a recovered network clears the banner without a press.
  const enteredStale = useRef(staleShiftId != null || !shiftKnown);
  useEffect(() => {
    if (enteredStale.current) void handleRetryReload();
  }, [handleRetryReload]);

  const view = closeShiftView({
    hasShift: shift != null,
    staleShiftId,
    preview,
    shiftKnown,
  });
  const stale = view.staleBanner;

  if (!shift && !stale && !view.unknownBanner) {
    return <BlockScreen label="No shift is open" link="/" />;
  }

  const cashActualCents = Math.round(cashActual * MONEY_SCALE);

  const handleClose = async () => {
    if (!view.canClose || !shift) return;
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setLoading(true);
    try {
      // DTO 단순화 — 서버가 aggregate 전부 재계산 (D-34 / D-37).
      const { ok, msg, mismatch } = await closeShift({
        closedNote: note.trim(),
        endedCashActual: cashActualCents,
        expectedShiftId: shift.id,
      });
      if (ok) {
        try {
          const shiftRes = await getShiftById(shift.id);
          if (shiftRes.ok && shiftRes.result) {
            await printShiftSettlementReceipt(shiftRes.result);
          }
        } catch {
          // print failure should not block close
        }
        navigate("/");
      } else if (mismatch) {
        // T-10 review: the count belonged to the old shift, so start over.
        // The shift was reloaded from the server, or — if that reload failed —
        // the screen stays stale (Retry banner, Close disabled) until it works.
        setConfirmClose(false);
        setCashActual(0);
        setNote("");
        setCountGeneration((g) => g + 1);
        window.alert(msg);
      } else {
        window.alert(msg || "Failed to close shift");
      }
    } catch {
      window.alert("Failed to close shift");
    } finally {
      setLoading(false);
    }
  };

  const homeButton = (
    <button
      onClick={() => navigate("/")}
      className="rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
    >
      Home
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200">
        <h1 className="text-xl font-bold">Close Shift</h1>
        <div className="flex items-center gap-3">
          {view.body === "ready" && (
            <span className="text-lg font-medium">Actual: {fmt(cashActualCents)}</span>
          )}
          <button
            onClick={() => navigate(-1)}
            disabled={loading}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            disabled={loading || !view.canClose}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading
              ? "Closing..."
              : confirmClose
                ? "Tap again to confirm"
                : "Close Shift"}
          </button>
        </div>
      </div>

      {stale && (
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-red-200 bg-red-50 text-red-800">
          <span className="text-sm font-medium">
            Shift {staleShiftId} is no longer open. {SHIFT_RELOAD_FAILED_MESSAGE}
          </span>
          <div className="flex gap-2">
            {homeButton}
            <button
              onClick={handleRetryReload}
              disabled={retrying}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        </div>
      )}

      {view.unknownBanner && (
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-red-200 bg-red-50 text-red-800">
          <span className="text-sm font-medium">{SHIFT_LOAD_FAILED_MESSAGE}</span>
          <div className="flex gap-2">
            {homeButton}
            <button
              onClick={handleRetryReload}
              disabled={retrying}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        </div>
      )}

      {view.body === "no-shift" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
          No shift is open
          {homeButton}
        </div>
      )}

      {view.body === "loading" && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Loading closing data...
        </div>
      )}

      {view.body === "preview-failed" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
          <span className="font-medium">Could not load the closing data</span>
          {previewMsg && <span className="text-sm text-gray-500">{previewMsg}</span>}
          <div className="flex gap-2">
            {homeButton}
            <button
              onClick={() => void fetchData()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {view.body === "ready" && shift && closingData && (
        <ReadyBody
          shift={shift}
          closingData={closingData}
          cashActualCents={cashActualCents}
          cashActual={cashActual}
          setCashActual={setCashActual}
          note={note}
          setNote={setNote}
          countGeneration={countGeneration}
        />
      )}
    </div>
  );
}

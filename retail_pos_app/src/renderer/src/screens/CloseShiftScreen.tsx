import { useCallback, useEffect, useState } from "react";
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

const fmt = (cents: number) => `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const signedFmt = (cents: number) => {
  if (cents === 0) return fmt(0);
  return (cents > 0 ? "+" : "-") + fmt(cents);
};
const netFmt = (cents: number) => (cents < 0 ? `-${fmt(cents)}` : fmt(cents));

export default function CloseShiftScreen() {
  const navigate = useNavigate();
  const { shift, closeShift } = useShift();
  const [cashActual, setCashActual] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [closingData, setClosingData] = useState<ClosingShiftData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);

  const fetchData = useCallback(async () => {
    setFetching(true);
    try {
      const res = await getClosingShiftData();
      if (res.ok && res.result) {
        setClosingData(res.result);
      }
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (shift) fetchData();
    else setFetching(false);
  }, [shift, fetchData]);

  if (!shift) {
    return <BlockScreen label="No shift is open" link="/" />;
  }

  if (fetching || !closingData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading closing data...
      </div>
    );
  }

  const { aggregate, endedCashExpected } = closingData;
  const startedCash = shift.startedCash;
  const cashActualCents = Math.round(cashActual * MONEY_SCALE);
  const difference = cashActualCents - endedCashExpected;

  // Voucher 는 user / customer 분리 저장 (D-20). UI 는 합산 표시.
  const salesVoucher = aggregate.salesUserVoucher + aggregate.salesCustomerVoucher;
  const refundsVoucher =
    aggregate.refundsUserVoucher + aggregate.refundsCustomerVoucher;
  const netCredit = aggregate.salesCredit - aggregate.refundsCredit;
  const netVoucher = salesVoucher - refundsVoucher;
  const netGiftcard = aggregate.salesGiftcard - aggregate.refundsGiftcard;

  const tenderSummaryRows: [string, string][] = [
    ["Cash Drawer", fmt(endedCashExpected)],
    ["Card Terminal", netFmt(netCredit)],
    ["Voucher", netFmt(netVoucher)],
    ["Gift Card", netFmt(netGiftcard)],
  ];

  const handleClose = async () => {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setLoading(true);
    try {
      // DTO 단순화 — 서버가 aggregate 전부 재계산 (D-34 / D-37).
      const { ok, msg } = await closeShift({
        closedNote: note.trim(),
        endedCashActual: cashActualCents,
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
      } else {
        window.alert(msg || "Failed to close shift");
      }
    } catch {
      window.alert("Failed to close shift");
    } finally {
      setLoading(false);
    }
  };

  // 한 줄 단위 요약. 값이 0 이어도 주요 항목은 표시 (상태가 정확히 보이도록).
  const summaryRows: [string, string][] = [
    ["Started Cash", fmt(startedCash)],
    [`Sales (${aggregate.salesCount})`, ""],
    ["  Cash", fmt(aggregate.salesCash)],
    ["  Credit", fmt(aggregate.salesCredit)],
    ["  Voucher", fmt(salesVoucher)],
    ["  Gift Card", fmt(aggregate.salesGiftcard)],
    ["  GST", fmt(aggregate.salesTax)],
    ...(aggregate.repayCount > 0
      ? ([[`  (repaid: ${aggregate.repayCount})`, ""]] as [string, string][])
      : []),
    [`Refunds (${aggregate.refundsCount})`, ""],
    ["  Cash", `-${fmt(aggregate.refundsCash)}`],
    ["  Credit", `-${fmt(aggregate.refundsCredit)}`],
    ["  Voucher", `-${fmt(refundsVoucher)}`],
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
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200">
        <h1 className="text-xl font-bold">Close Shift</h1>
        <div className="flex items-center gap-3">
          <span className="text-lg font-medium">Actual: {fmt(cashActualCents)}</span>
          <button
            onClick={() => navigate(-1)}
            disabled={loading}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            disabled={loading}
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

      <div className="flex-1 flex overflow-hidden">
        {/* Summary */}
        <div className="w-[340px] border-r border-gray-200 p-4 flex flex-col">
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
          <CashCounter value={cashActual} onChange={setCashActual} />
        </div>
      </div>
    </div>
  );
}

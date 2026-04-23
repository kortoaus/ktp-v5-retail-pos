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

  const {
    salesCash,
    salesCredit,
    salesUserVoucher,
    salesCustomerVoucher,
    salesTax,
    refundsCash,
    refundsCredit,
    refundsUserVoucher,
    refundsCustomerVoucher,
    refundsTax,
    cashIn,
    cashOut,
  } = closingData;

  // Voucher 는 user / customer 분리 저장 (D-20). UI/드로어 계산에는 합산 표시.
  const salesVoucher = salesUserVoucher + salesCustomerVoucher;
  const refundsVoucher = refundsUserVoucher + refundsCustomerVoucher;

  const startedCash = shift.startedCash;
  const cashActualCents = Math.round(cashActual * MONEY_SCALE);

  const expectedCash = startedCash + salesCash - refundsCash + cashIn - cashOut;
  const difference = cashActualCents - expectedCash;
  const totalCashIn = startedCash + salesCash + cashIn;
  const totalCashOut = refundsCash + cashOut;

  const handleClose = async () => {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setLoading(true);
    try {
      const { ok, msg } = await closeShift({
        closedNote: note.trim(),
        endedCashExpected: expectedCash,
        endedCashActual: cashActualCents,
        salesCash,
        salesCredit,
        salesUserVoucher,
        salesCustomerVoucher,
        salesTax,
        refundsCash,
        refundsCredit,
        refundsUserVoucher,
        refundsCustomerVoucher,
        refundsTax,
        cashIn,
        cashOut,
        totalCashIn,
        totalCashOut,
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

  const summaryRows: [string, string][] = [
    ["Started Cash", fmt(startedCash)],
    ["Sales (Cash)", fmt(salesCash)],
    ["Sales (Credit)", fmt(salesCredit)],
    ["Sales (Voucher)", fmt(salesVoucher)],
    ["Sales Tax", fmt(salesTax)],
    ["Refunds (Cash)", `-${fmt(refundsCash)}`],
    ["Refunds (Credit)", `-${fmt(refundsCredit)}`],
    ["Refunds (Voucher)", `-${fmt(refundsVoucher)}`],
    ["Refunds Tax", `-${fmt(refundsTax)}`],
    ["Cash In", fmt(cashIn)],
    ["Cash Out", `-${fmt(cashOut)}`],
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
          <h3 className="text-sm font-bold mb-3">Shift Summary</h3>
          <div className="flex flex-col gap-1 text-lg">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="flex justify-between py-0.5">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-3 border-t border-gray-200 flex flex-col gap-1">
            <div className="flex justify-between text-lg font-bold">
              <span>Expected</span>
              <span>{fmt(expectedCash)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Actual</span>
              <span>{fmt(cashActualCents)}</span>
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
              <span>
                {difference > 0 ? "+" : difference < 0 ? "-" : ""}
                {fmt(difference)}
              </span>
            </div>
          </div>

          <div className="mt-auto pt-3">
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

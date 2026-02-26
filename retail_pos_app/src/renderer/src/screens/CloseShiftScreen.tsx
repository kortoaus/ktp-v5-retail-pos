import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Decimal from "decimal.js";
import CashCounter from "../components/CashCounter";
import KeyboardInputText from "../components/KeyboardInputText";
import BlockScreen from "../components/BlockScreen";
import { useShift } from "../contexts/ShiftContext";
import {
  getClosingShiftData,
  getShiftById,
  type ClosingShiftData,
} from "../service/shift.service";
import { MONEY_DP } from "../libs/constants";
import { printShiftSettlementReceipt } from "../libs/printer/shift-settlement-receipt";

const fmt = (n: number) => `$${Math.abs(n).toFixed(MONEY_DP)}`;

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
    salesTax,
    refundsCash,
    refundsCredit,
    refundsTax,
    cashIn,
    cashOut,
  } = closingData;

  const startedCash = shift.startedCach / 100;

  const expectedCash = new Decimal(startedCash)
    .add(salesCash)
    .sub(refundsCash)
    .add(cashIn)
    .sub(cashOut)
    .toNumber();

  const difference = new Decimal(cashActual).sub(expectedCash).toNumber();

  const totalCashIn = new Decimal(startedCash)
    .add(salesCash)
    .add(cashIn)
    .toNumber();

  const totalCashOut = new Decimal(refundsCash).add(cashOut).toNumber();

  const toCents = (n: number) => Math.round(new Decimal(n).mul(100).toNumber());

  const handleClose = async () => {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setLoading(true);
    try {
      const { ok, msg } = await closeShift({
        closedNote: note.trim(),
        endedCashExpected: toCents(expectedCash),
        endedCashActual: toCents(cashActual),
        salesCash: toCents(salesCash),
        salesCredit: toCents(salesCredit),
        salesTax: toCents(salesTax),
        refundsCash: toCents(refundsCash),
        refundsCredit: toCents(refundsCredit),
        refundsTax: toCents(refundsTax),
        cashIn: toCents(cashIn),
        cashOut: toCents(cashOut),
        totalCashIn: toCents(totalCashIn),
        totalCashOut: toCents(totalCashOut),
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
    ["Sales Tax", fmt(salesTax)],
    ["Refunds (Cash)", `-${fmt(refundsCash)}`],
    ["Refunds (Credit)", `-${fmt(refundsCredit)}`],
    ["Refunds Tax", `-${fmt(refundsTax)}`],
    ["Cash In", fmt(cashIn)],
    ["Cash Out", `-${fmt(cashOut)}`],
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200">
        <h1 className="text-xl font-bold">Close Shift</h1>
        <div className="flex items-center gap-3">
          <span className="text-lg font-medium">Actual: {fmt(cashActual)}</span>
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
              <span>{fmt(cashActual)}</span>
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

import { MONEY_DP, MONEY_SCALE } from "../../../libs/constants";
import { cn } from "../../../libs/cn";
import { eftposAmountOf, surchargeOf } from "./usePaymentCal";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// Controlled component, BILL-first model.
//   billPortion = the part of the bill the customer wants on credit
//                 (= what counts toward `paid` in summary).
//   eftposAmount = billPortion × (1 + rate)
//                 = the amount keyed into the EFTPOS machine
//                 = stored as payment.amount (D-10).
// Parent owns staged.amount (= EFTPOS) and derives billPortion via inverse for
// this prop. Numpad edits billPortion; surcharge derivation is local.
export default function CreditInput({
  billPortion,
  setBillPortion,
  left,
  surchargeRate, // raw int per StoreSetting comment: 15 = 1.5%
  onCommit,
}: {
  billPortion: number;
  setBillPortion: (next: number) => void;
  left: number;
  surchargeRate: number;
  onCommit: () => void;
}) {
  // Use shared helpers so the displayed EFTPOS exactly matches what parent stores.
  const surcharge = surchargeOf(billPortion, surchargeRate);
  const eftposAmount = eftposAmountOf(billPortion, surchargeRate);
  const canCommit = billPortion > 0;

  // Numpad: cents-accumulator on billPortion. Hard cap = `left` (bill terms).
  function pushKey(key: "DEL" | "CLS" | string) {
    if (key === "CLS") {
      setBillPortion(0);
      return;
    }
    if (key === "DEL") {
      const str = String(billPortion);
      setBillPortion(str.length <= 1 ? 0 : parseInt(str.slice(0, -1), 10));
      return;
    }
    const candidate = parseInt(String(billPortion) + key, 10);
    if (candidate > left) return;
    setBillPortion(candidate);
  }

  const ratePct = (surchargeRate / 10).toFixed(1); // 15 → "1.5"

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Display — big BILL only. EFTPOS shows on Add button + below as hint */}
      <div className="bg-zinc-900 text-white rounded-md p-3">
        <Row label="BILL PORTION" valueClass="text-2xl text-sky-300">
          ${fmtMoney(billPortion)}
        </Row>
        <div className="text-[10px] text-gray-500 mt-1">
          Surcharge {ratePct}%
          {surcharge > 0 && ` · +$${fmtMoney(surcharge)}`}
        </div>
      </div>

      {/* EXACT — auto-complete remaining bill */}
      <button
        type="button"
        onClick={() => setBillPortion(left)}
        disabled={left <= 0}
        className={cn(
          "h-14 rounded-md font-bold text-base border flex flex-col items-center justify-center",
          left <= 0
            ? "bg-gray-100 text-gray-400 border-gray-200"
            : "bg-blue-600 text-white border-blue-700 active:bg-blue-700",
        )}
      >
        <span>EXACT</span>
        {left > 0 && (
          <span className="text-xs font-normal text-blue-100">
            ${fmtMoney(left)}
          </span>
        )}
      </button>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-1">
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <NumKey key={k} label={k} onClick={() => pushKey(k)} />
        ))}
        <NumKey label="DEL" onClick={() => pushKey("DEL")} variant="warn" />
        <NumKey label="0" onClick={() => pushKey("0")} />
        <NumKey label="00" onClick={() => pushKey("00")} />
        <NumKey
          label="CLS"
          onClick={() => pushKey("CLS")}
          variant="warn"
          className="col-span-3"
        />
      </div>

      {/* Commit — dual notation: ADD CREDIT · $bill ($eftpos) */}
      <button
        type="button"
        onClick={onCommit}
        disabled={!canCommit}
        className={cn(
          "h-12 rounded-md font-bold text-white text-sm tracking-wide",
          canCommit
            ? "bg-blue-600 active:bg-blue-700"
            : "bg-gray-300 cursor-not-allowed",
        )}
      >
        ADD CREDIT
        {canCommit &&
          ` · $${fmtMoney(billPortion)} ($${fmtMoney(eftposAmount)})`}
      </button>
    </div>
  );
}

function Row({
  label,
  valueClass,
  children,
}: {
  label: string;
  valueClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-gray-400 tracking-[0.15em]">{label}</span>
      <span className={cn("font-bold font-mono", valueClass)}>{children}</span>
    </div>
  );
}

function NumKey({
  label,
  onClick,
  variant = "default",
  className,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "warn";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-12 rounded-md font-bold text-lg border active:scale-95 transition-transform",
        variant === "warn"
          ? "bg-amber-50 text-amber-700 border-amber-300 active:bg-amber-100"
          : "bg-white text-black border-gray-300 active:bg-gray-100",
        className,
      )}
    >
      {label}
    </button>
  );
}

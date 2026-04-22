import { MONEY_DP, MONEY_SCALE } from "../../../libs/constants";
import { cn } from "../../../libs/cn";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// AU denominations (notes + top 3 coins), descending. Cents.
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50] as const;

// Controlled component. Parent owns `cashReceived` (it lives inside the
// staged PaymentQueueItem). EXACT replaces; denominations top-up; numpad
// edits digit-by-digit. `applied = min(received, left)` is parent's concern,
// derived here only for display + canCommit.
export default function CashInput({
  cashReceived,
  setCashReceived,
  left,
  exactAmount,
  onCommit,
}: {
  cashReceived: number;
  setCashReceived: (next: number) => void;
  left: number;
  // EXACT 버튼에 넣을 금액. Cash-only 모드 (non-cash committed 없음) 일 땐 parent
  // 가 round5(left) 를 넘겨줘서 cashIntent >= roundedCashTarget 충족 → rounding
  // 작동. Mixed tender 면 left 와 동일.
  exactAmount: number;
  onCommit: () => void;
}) {
  const applied = Math.min(cashReceived, left);
  const canCommit = applied > 0;

  // Numpad: cents-accumulator. Press "5" → $0.05, "0" → $0.50, "00" → $50.00.
  function pushKey(key: "DEL" | "CLS" | string) {
    if (key === "CLS") {
      setCashReceived(0);
      return;
    }
    if (key === "DEL") {
      const str = String(cashReceived);
      setCashReceived(str.length <= 1 ? 0 : parseInt(str.slice(0, -1), 10));
      return;
    }
    setCashReceived(parseInt(String(cashReceived) + key, 10));
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Display — RECEIVED only. Change is summarized in the Summary panel. */}
      <div className="bg-zinc-900 text-white rounded-md p-3">
        <Row label="RECEIVED" valueClass="text-2xl text-green-400">
          ${fmtMoney(cashReceived)}
        </Row>
      </div>

      {/* Quick buttons — EXACT + AU denominations (notes + top coins) */}
      <div className="grid grid-cols-3 gap-2">
        <QuickBtn
          label="EXACT"
          subLabel={exactAmount > 0 ? `$${fmtMoney(exactAmount)}` : "—"}
          onClick={() => setCashReceived(exactAmount)}
          disabled={exactAmount <= 0}
          accent
        />
        {DENOMS.map((cents) => (
          <QuickBtn
            key={cents}
            label={`$${fmtMoney(cents)}`}
            onClick={() => setCashReceived(cashReceived + cents)}
          />
        ))}
      </div>

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

      {/* Commit */}
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
        ADD CASH PAYMENT
        {canCommit && ` · $${fmtMoney(applied)}`}
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

function QuickBtn({
  label,
  subLabel,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  subLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "h-14 rounded-md font-bold text-base border flex flex-col items-center justify-center",
        disabled
          ? "bg-gray-100 text-gray-400 border-gray-200"
          : accent
            ? "bg-blue-600 text-white border-blue-700 active:bg-blue-700"
            : "bg-white text-black border-gray-300 active:bg-gray-100",
      )}
    >
      <span>{label}</span>
      {subLabel && (
        <span
          className={cn(
            "text-xs font-normal",
            accent ? "text-blue-100" : "text-gray-500",
          )}
        >
          {subLabel}
        </span>
      )}
    </button>
  );
}

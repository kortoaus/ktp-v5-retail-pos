import { useState } from "react";
import { MONEY_DP, MONEY_SCALE } from "../../../libs/constants";
import { cn } from "../../../libs/cn";
import SearchUserVoucherModal from "./SearchUserVoucherModal";
import { Voucher } from "../../../service/voucher.service";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// USER_VOUCHER input. Two-phase: (1) pick a voucher via the Search modal
// (existing active voucher OR issue a new daily on the spot), (2) enter the
// amount to apply (capped at min(left, voucher.balance)).
export default function UserVoucherInput({
  amount,
  setAmount,
  left,
  voucher, // null until the user selects/issues one
  userLabel,
  usedVoucherIds,
  onSelectVoucher,
  onCommit,
}: {
  amount: number;
  setAmount: (next: number) => void;
  left: number;
  voucher: Voucher | null;
  userLabel: string;
  // 이미 committed 된 user-voucher id 목록. Modal 에서 disabled 처리 용도.
  usedVoucherIds: number[];
  onSelectVoucher: (
    user: { id: number; name: string },
    voucher: Voucher,
  ) => void;
  onCommit: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const selected = voucher !== null;
  const balance = voucher?.balance ?? 0;
  const cap = Math.min(left, balance);
  const canCommit = selected && amount > 0;

  function pushKey(key: "DEL" | "CLS" | string) {
    if (!selected) return;
    if (key === "CLS") {
      setAmount(0);
      return;
    }
    if (key === "DEL") {
      const str = String(amount);
      setAmount(str.length <= 1 ? 0 : parseInt(str.slice(0, -1), 10));
      return;
    }
    const candidate = parseInt(String(amount) + key, 10);
    if (candidate > cap) return;
    setAmount(candidate);
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Display */}
      <div className="bg-zinc-900 text-white rounded-md p-3">
        <Row label="USER VOUCHER" valueClass="text-2xl text-amber-300">
          ${fmtMoney(amount)}
        </Row>
        {selected ? (
          <div className="text-[10px] text-gray-400 mt-1 flex justify-between">
            <span>{userLabel}</span>
            <span>Balance ${fmtMoney(balance)}</span>
          </div>
        ) : (
          <div className="text-[10px] text-gray-500 mt-1">
            No voucher selected
          </div>
        )}
      </div>

      {/* Search / Change button */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={cn(
          "h-14 rounded-md font-bold text-base border flex flex-col items-center justify-center",
          selected
            ? "bg-white text-black border-gray-300 active:bg-gray-100"
            : "bg-blue-600 text-white border-blue-700 active:bg-blue-700",
        )}
      >
        <span>{selected ? "Change Voucher" : "Search Voucher"}</span>
        {selected && (
          <span className="text-xs font-normal text-gray-500">{userLabel}</span>
        )}
      </button>

      {/* EXACT — auto-complete to cap (min of bill-left and voucher balance) */}
      <button
        type="button"
        onClick={() => setAmount(cap)}
        disabled={!selected || cap <= 0}
        className={cn(
          "h-14 rounded-md font-bold text-base border flex flex-col items-center justify-center",
          !selected || cap <= 0
            ? "bg-gray-100 text-gray-400 border-gray-200"
            : "bg-blue-600 text-white border-blue-700 active:bg-blue-700",
        )}
      >
        <span>EXACT</span>
        {selected && cap > 0 && (
          <span className="text-xs font-normal text-blue-100">
            ${fmtMoney(cap)}
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
        ADD USER VOUCHER
        {canCommit && ` · $${fmtMoney(amount)}`}
      </button>

      <SearchUserVoucherModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        usedVoucherIds={usedVoucherIds}
        onSelect={(user, v) => {
          onSelectVoucher(user, v);
          setModalOpen(false);
        }}
      />
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

import { useCallback, useEffect, useMemo, useState } from "react";
import OnScreenKeyboard from "../../../components/OnScreenKeyboard";
import { MONEY_DP, MONEY_SCALE } from "../../../libs/constants";
import { useStoreSetting } from "../../../hooks/useStoreSetting";
import {
  DailyVoucherRow,
  Voucher,
  getDailyVouchers,
  issueDailyVoucher,
} from "../../../service/voucher.service";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

interface Props {
  open: boolean;
  onClose: () => void;
  // PaymentModal 에서 committed 된 user-voucher 의 voucher id 목록.
  // 해당 voucher row 는 balance 있어도 disabled ("In use") — 중복 선택 차단.
  usedVoucherIds: number[];
  onSelect: (user: { id: number; name: string }, voucher: Voucher) => void;
}

// Staff daily voucher picker. Each row shows a user + either a balance button
// (active voucher exists, select it) or an Issue button (no active voucher,
// issues one on the server then auto-selects). Balance 0 → disabled (still
// shows "$0.00", hints that today's voucher is exhausted). Already-committed
// voucher → disabled with "In use" — forces cashier to remove the existing
// entry first.
export default function SearchUserVoucherModal({
  open,
  onClose,
  usedVoucherIds,
  onSelect,
}: Props) {
  const { storeSetting } = useStoreSetting();
  const dailyDefault = storeSetting?.user_daily_voucher_default ?? 0;

  const [rows, setRows] = useState<DailyVoucherRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuingId, setIssuingId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDailyVouchers();
      setRows(res.ok && res.result ? res.result : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    refetch();
  }, [open, refetch]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(k) || r.code.toLowerCase().includes(k),
    );
  }, [rows, keyword]);

  const handleIssue = useCallback(
    async (row: DailyVoucherRow) => {
      setIssuingId(row.id);
      try {
        const res = await issueDailyVoucher(row.id);
        if (!res.ok || !res.result) {
          window.alert(res.msg || "Failed to issue voucher");
          return;
        }
        onSelect({ id: row.id, name: row.name }, res.result);
      } finally {
        setIssuingId(null);
      }
    },
    [onSelect],
  );

  const handlePick = useCallback(
    (row: DailyVoucherRow) => {
      if (!row.voucher || row.voucher.balance <= 0) return;
      if (usedVoucherIds.includes(row.voucher.id)) return;
      onSelect({ id: row.id, name: row.name }, row.voucher);
    },
    [onSelect, usedVoucherIds],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1000 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Select Staff Daily Voucher</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
            <span className="text-gray-400 text-lg">🔍</span>
            <div className="flex-1 text-lg min-h-[28px]">
              {keyword || (
                <span className="text-gray-400">Type name or code</span>
              )}
            </div>
            {loading && (
              <span className="text-sm text-gray-400">Loading...</span>
            )}
            {keyword && !loading && (
              <button
                type="button"
                onPointerDown={() => setKeyword("")}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              {rows.length === 0 ? "No staff" : "No match"}
            </div>
          )}
          {filtered.map((row) => {
            const v = row.voucher;
            const isUsed = !!v && usedVoucherIds.includes(v.id);
            const hasBalance = !!v && v.balance > 0;
            const canPick = hasBalance && !isUsed;
            const isIssuing = issuingId === row.id;
            return (
              <div
                key={row.id}
                className="w-full px-4 h-16 border-b border-gray-100 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-sm">{row.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {row.code}
                  </div>
                </div>
                <div className="shrink-0">
                  {v ? (
                    <button
                      type="button"
                      disabled={!canPick}
                      onPointerDown={() => handlePick(row)}
                      className={
                        canPick
                          ? "min-w-[110px] h-12 px-4 rounded-lg font-bold text-sm bg-emerald-600 text-white active:bg-emerald-700 flex flex-col items-center justify-center"
                          : "min-w-[110px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-200 text-gray-400 cursor-not-allowed flex flex-col items-center justify-center"
                      }
                    >
                      {isUsed ? (
                        <>
                          <span>In use</span>
                          <span className="text-[10px] font-normal opacity-80">
                            ${fmtMoney(v.balance)}
                          </span>
                        </>
                      ) : (
                        <span>${fmtMoney(v.balance)}</span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isIssuing || dailyDefault <= 0}
                      onPointerDown={() => handleIssue(row)}
                      className={
                        isIssuing || dailyDefault <= 0
                          ? "min-w-[110px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-200 text-gray-400 flex flex-col items-center justify-center"
                          : "min-w-[110px] h-12 px-4 rounded-lg font-bold text-sm bg-blue-600 text-white active:bg-blue-700 flex flex-col items-center justify-center"
                      }
                    >
                      <span>{isIssuing ? "..." : "Issue"}</span>
                      <span className="text-[10px] font-normal opacity-80">
                        ${fmtMoney(dailyDefault)}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-200 p-2">
          <OnScreenKeyboard
            value={keyword}
            onChange={setKeyword}
            onEnter={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

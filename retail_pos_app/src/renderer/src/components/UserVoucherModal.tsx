import { useCallback, useEffect, useState } from "react";
import { User, UserVoucher } from "../types/models";
import { getPublicUsers } from "../service/user.service";
import {
  getUserVouchersByUserIds,
  issueUserDailyVoucher,
} from "../service/user.voucher.service";
import OnScreenKeyboard from "./OnScreenKeyboard";
import LoadingOverlay from "./LoadingOverlay";
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";
import { cn } from "../libs/cn";

const RESULT_LIMIT = 5;

type UserWithVoucher = User & {
  voucher: UserVoucher | null;
};

interface UserVoucherModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (voucher: UserVoucher) => void;
}

export default function UserVoucherModal({
  open,
  onClose,
  onSelect,
}: UserVoucherModalProps) {
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<UserWithVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setResult([]);
    setLoading(false);
    setSearched(false);
  }, [open]);

  const handleSearch = useCallback(async () => {
    const trimmed = keyword.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setSearched(true);
    try {
      const userRes = await getPublicUsers(
        `?keyword=${trimmed}&limit=${RESULT_LIMIT}`,
      );
      if (!userRes.ok || !userRes.result) {
        setResult([]);
        return;
      }

      const userIds = userRes.result.map((u) => u.id);
      const voucherRes = await getUserVouchersByUserIds(userIds);
      const vouchers =
        voucherRes.ok && voucherRes.result ? voucherRes.result : [];

      setResult(
        userRes.result.map((user) => ({
          ...user,
          voucher: vouchers.find((v) => v.userId === user.id) ?? null,
        })),
      );
      setKeyword("");
    } catch {
      setResult([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, loading]);

  const handleIssue = useCallback(
    async (userId: number) => {
      if (loading) return;

      const idx = result.findIndex((u) => u.id === userId);
      if (idx === -1) return;

      const ask = window.confirm(
        `Issue voucher to [${result[idx].name}]?`,
      );
      if (!ask) return;

      setLoading(true);
      try {
        const res = await issueUserDailyVoucher(userId);
        if (res.ok && res.result) {
          const issued = res.result;
          setResult((prev) =>
            prev.map((u) =>
              u.id === userId ? { ...u, voucher: issued } : u,
            ),
          );
        } else {
          window.alert(res.msg || "Failed to issue voucher");
        }
      } catch {
        window.alert("Failed to issue voucher");
      } finally {
        setLoading(false);
      }
    },
    [loading, result],
  );

  const handleVoucherSelect = useCallback(
    (voucher: UserVoucher) => {
      if (voucher.left_amount <= 0) {
        window.alert("No voucher balance remaining");
        return;
      }
      onSelect(voucher);
    },
    [onSelect],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">User Voucher</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 relative">
          {loading && <LoadingOverlay label="Loading..." />}

          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
              <div className="flex-1 text-lg min-h-[28px]">
                {keyword || (
                  <span className="text-gray-400">Search user name</span>
                )}
              </div>
              {keyword && (
                <button
                  type="button"
                  onPointerDown={() => setKeyword("")}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              onPointerDown={handleSearch}
              disabled={!keyword.trim() || loading}
              className="h-12 px-4 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm shrink-0"
            >
              Search
            </button>
          </div>

          <div className="min-h-[280px]">
            {!searched && (
              <div className="h-[280px] flex items-center justify-center">
                <span className="text-gray-400 text-sm">
                  Search user by name
                </span>
              </div>
            )}
            {searched && !loading && result.length === 0 && (
              <div className="h-[280px] flex items-center justify-center">
                <span className="text-gray-400 text-sm">No users found</span>
              </div>
            )}
            {result.length > 0 && (
              <div className="flex flex-col divide-y divide-gray-200">
                {result.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between h-14 px-1"
                  >
                    <div className="text-base font-medium truncate flex-1 min-w-0">
                      {user.name}
                    </div>
                    {user.voucher === null ? (
                      <button
                        type="button"
                        onPointerDown={() => handleIssue(user.id)}
                        className="h-10 w-24 bg-blue-500 text-white rounded-md font-bold text-sm shrink-0 active:bg-blue-600"
                      >
                        Issue
                      </button>
                    ) : (
                      <button
                        type="button"
                        onPointerDown={() =>
                          handleVoucherSelect(user.voucher!)
                        }
                        className={cn(
                          "h-10 w-24 rounded-md font-bold text-sm shrink-0 text-white",
                          user.voucher.left_amount > 0
                            ? "bg-green-600 active:bg-green-700"
                            : "bg-gray-400",
                        )}
                      >
                        {`$${(user.voucher.left_amount / MONEY_SCALE).toFixed(MONEY_DP)}`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 p-2">
          <OnScreenKeyboard
            value={keyword}
            onChange={setKeyword}
            onEnter={handleSearch}
            initialLayout="english"
          />
        </div>
      </div>
    </div>
  );
}

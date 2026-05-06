import { useCallback, useEffect, useState } from "react";
import {
  CUSTOMER_VOUCHER_ISSUE_AMOUNT,
  CUSTOMER_VOUCHER_ISSUE_POINTS,
  MONEY_DP,
  MONEY_SCALE,
} from "../../../libs/constants";
import {
  CustomerVoucher,
  getValidCustomerVouchers,
  issueCustomerVoucher,
} from "../../../service/customer-voucher.service";
import TapTarget from "./TapTarget";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
const fmtDate = (value: string) => value.slice(0, 10);

type Props = {
  open: boolean;
  memberId: string;
  memberPoints: number;
  usedVoucherIds: number[];
  onClose: () => void;
  onSelect: (voucher: CustomerVoucher, memberPoints?: number) => void;
};

export default function SearchCustomerVoucherModal({
  open,
  memberId,
  memberPoints,
  usedVoucherIds,
  onClose,
  onSelect,
}: Props) {
  const [rows, setRows] = useState<CustomerVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getValidCustomerVouchers(memberId);
      setRows(res.ok && res.result ? res.result : []);
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    if (!open) return;
    refetch();
  }, [open, refetch]);

  const handleIssue = useCallback(async () => {
    if (memberPoints < CUSTOMER_VOUCHER_ISSUE_POINTS) return;
    setIssuing(true);
    try {
      const res = await issueCustomerVoucher(memberId);
      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to issue voucher");
        return;
      }
      onSelect(res.result.voucher, res.result.memberPoints);
      onClose();
    } finally {
      setIssuing(false);
    }
  }, [memberId, memberPoints, onClose, onSelect]);

  const handlePick = useCallback(
    (voucher: CustomerVoucher) => {
      if (usedVoucherIds.includes(voucher.id)) return;
      onSelect(voucher);
      onClose();
    },
    [onClose, onSelect, usedVoucherIds],
  );

  if (!open) return null;

  const canIssue = memberPoints >= CUSTOMER_VOUCHER_ISSUE_POINTS;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1000 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Select Customer Voucher</h2>
          <TapTarget
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </TapTarget>
        </div>

        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.15em] text-gray-500">
              Member Points
            </div>
            <div className="font-mono text-lg font-bold">
              {memberPoints.toLocaleString()}
            </div>
          </div>
          {canIssue && (
            <TapTarget
              onPointerDown={handleIssue}
              disabled={issuing}
              className={
                issuing
                  ? "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-200 text-gray-400 flex items-center justify-center"
                  : "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-blue-600 text-white active:bg-blue-700 flex items-center justify-center"
              }
            >
              {issuing
                ? "..."
                : `ISSUE $${fmtMoney(CUSTOMER_VOUCHER_ISSUE_AMOUNT)}`}
            </TapTarget>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {rows.length === 0 && !loading && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              No vouchers
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              Loading...
            </div>
          )}
          {!loading &&
            rows.map((voucher) => {
              const isUsed = usedVoucherIds.includes(voucher.id);
              return (
                <div
                  key={voucher.id}
                  className="w-full px-4 h-16 border-b border-gray-100 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">
                      {voucher.serial}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      Expires {fmtDate(voucher.validTo)}
                    </div>
                  </div>
                  <TapTarget
                    disabled={isUsed}
                    onPointerDown={() => handlePick(voucher)}
                    className={
                      isUsed
                        ? "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-200 text-gray-400 cursor-not-allowed flex flex-col items-center justify-center"
                        : "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-emerald-600 text-white active:bg-emerald-700 flex flex-col items-center justify-center"
                    }
                  >
                    {isUsed ? (
                      <>
                        <span>In use</span>
                        <span className="text-[10px] font-normal opacity-80">
                          ${fmtMoney(voucher.balance)}
                        </span>
                      </>
                    ) : (
                      <span>${fmtMoney(voucher.balance)}</span>
                    )}
                  </TapTarget>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

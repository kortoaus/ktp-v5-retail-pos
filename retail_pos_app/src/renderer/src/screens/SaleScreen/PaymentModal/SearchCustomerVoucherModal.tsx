import { useCallback, useEffect, useState } from "react";
import { MONEY_DP, MONEY_SCALE } from "../../../libs/constants";
import {
  CustomerVoucher,
  getValidCustomerVouchers,
  issueCustomerVoucher,
  pendingCustomerVoucherIssue,
  resumeCustomerVoucherIssue,
} from "../../../service/customer-voucher.service";
import {
  canExchangePoints,
  decideIssueAnswer,
  memberPointsAfterIssue,
  PENDING_EXCHANGE_NOTICE,
  voucherTierShortfall,
  type CustomerVoucherTier,
  type PendingVoucherIssue,
} from "../../../libs/customer-voucher-issue";
import { searchMemberById } from "../../../service/crm.service";
import {
  voucherListStateFromAnswer,
  type VoucherListState,
} from "../../../libs/customer-voucher-list";
import dayjsAU from "../../../libs/dayjsAU";
import TapTarget from "./TapTarget";
import VoucherTierModal from "./VoucherTierModal";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
// T-17 (D-11): the Sydney calendar date, same as the voucher label and the
// customer app — never a UTC slice of validTo.
const fmtDate = (value: string) => dayjsAU(value).format("DD/MM/YYYY");

type Props = {
  open: boolean;
  memberId: string;
  memberPoints: number;
  usedVoucherIds: number[];
  onClose: () => void;
  onSelect: (voucher: CustomerVoucher) => void;
  // F-17: the member's points after any ok exchange answer (fresh or replay).
  onMemberPoints: (points: number) => void;
};

export default function SearchCustomerVoucherModal({
  open,
  memberId,
  memberPoints,
  usedVoucherIds,
  onClose,
  onSelect,
  onMemberPoints,
}: Props) {
  // T-25 (V-10): loading / CRM unavailable (Retry) / empty / ready — a failed
  // list read is never shown as "No vouchers".
  const [listState, setListState] = useState<VoucherListState>({ kind: "loading" });
  const [issuing, setIssuing] = useState(false);
  // D-24: Issue opens the tier list (+ two confirmations) in VoucherTierModal.
  const [tierOpen, setTierOpen] = useState(false);
  // D-24 review round 1: the member's unsettled exchange (answer lost) — it
  // must be finished (same operationId, stored amount) before a new one.
  const [pending, setPending] = useState<PendingVoucherIssue | null>(null);
  // F-16: set when a press replayed an earlier exchange (not auto-selected).
  const [notice, setNotice] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setListState({ kind: "loading" });
    let answer: Awaited<ReturnType<typeof getValidCustomerVouchers>> | null = null;
    try {
      answer = await getValidCustomerVouchers(memberId);
    } catch {
      answer = null;
    }
    setListState(voucherListStateFromAnswer(answer, new Date()));
  }, [memberId]);

  useEffect(() => {
    if (!open) return;
    const unsettled = pendingCustomerVoucherIssue(memberId);
    setPending(unsettled);
    // The shown points may be stale while an exchange is unconfirmed.
    setNotice(unsettled ? PENDING_EXCHANGE_NOTICE : null);
    setTierOpen(false);
    refetch();
  }, [open, memberId, refetch]);

  // One exchange request (new or resumed) and the existing answer handling.
  const runExchange = useCallback(
    async (send: () => ReturnType<typeof issueCustomerVoucher>) => {
      setIssuing(true);
      try {
        const decision = decideIssueAnswer(await send());
        if (decision.action === "error") {
          window.alert(decision.message);
          // A lost answer keeps the attempt: finish it before a new exchange.
          if (pendingCustomerVoucherIssue(memberId)) setNotice(PENDING_EXCHANGE_NOTICE);
          return;
        }
        // F-17: update the member's points on any ok answer, selected or not;
        // a replay without points re-reads the member before the modal moves on.
        const points = await memberPointsAfterIssue(decision.memberPoints, async () => {
          const res = await searchMemberById(memberId);
          return res.ok && res.result ? res.result.points : null;
        });
        if (points !== null) onMemberPoints(points);
        if (decision.action === "recovered") {
          // F-16: the recovered voucher may be spent, expired or already in
          // this sale — refresh the list and let the cashier pick.
          setNotice(decision.notice);
          await refetch();
          return;
        }
        onSelect(decision.voucher);
        onClose();
      } finally {
        setPending(pendingCustomerVoucherIssue(memberId));
        setIssuing(false);
        setTierOpen(false);
      }
    },
    [memberId, onClose, onMemberPoints, onSelect, refetch],
  );

  // D-24: called by VoucherTierModal only after the second confirmation.
  const handleIssue = useCallback(
    (tier: CustomerVoucherTier) => {
      if (issuing || pending || voucherTierShortfall(memberPoints, tier) > 0) return;
      void runExchange(() => issueCustomerVoucher(memberId, tier.amount));
    },
    [issuing, pending, memberId, memberPoints, runExchange],
  );

  // "Finish previous exchange" → Continue: no affordability check (CRM
  // already deducted the points if it issued).
  const handleResume = useCallback(() => {
    if (issuing || !pending) return;
    void runExchange(() => resumeCustomerVoucherIssue(memberId));
  }, [issuing, pending, memberId, runExchange]);

  const handlePick = useCallback(
    (voucher: CustomerVoucher) => {
      if (usedVoucherIds.includes(voucher.id)) return;
      onSelect(voucher);
      onClose();
    },
    [onClose, onSelect, usedVoucherIds],
  );

  if (!open) return null;

  const canIssue = pending !== null || canExchangePoints(memberPoints);

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
              onPointerDown={() => setTierOpen(true)}
              disabled={issuing}
              className={
                issuing
                  ? "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-200 text-gray-400 flex items-center justify-center"
                  : "min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-blue-600 text-white active:bg-blue-700 flex items-center justify-center"
              }
            >
              {issuing ? "..." : pending ? "FINISH EXCHANGE" : "ISSUE VOUCHER"}
            </TapTarget>
          )}
        </div>

        {notice && (
          <div className="px-4 py-2 border-b border-amber-200 bg-amber-50 text-sm text-amber-800">
            {notice}
          </div>
        )}

        <div className="max-h-96 overflow-y-auto">
          {listState.kind === "loading" && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              Loading...
            </div>
          )}
          {listState.kind === "unavailable" && (
            <div className="flex flex-col items-center justify-center gap-3 min-h-48">
              <div className="text-sm font-semibold text-red-600">
                {listState.message} — the member's vouchers could not be read
              </div>
              <TapTarget
                onPointerDown={refetch}
                className="min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-gray-900 text-white active:bg-black flex items-center justify-center"
              >
                Retry
              </TapTarget>
            </div>
          )}
          {listState.kind === "empty" && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              No vouchers
            </div>
          )}
          {listState.kind === "ready" &&
            listState.rows.map((voucher) => {
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
      <VoucherTierModal
        open={tierOpen}
        memberPoints={memberPoints}
        issuing={issuing}
        pending={pending}
        onCancel={() => setTierOpen(false)}
        onIssue={handleIssue}
        onResume={handleResume}
      />
    </div>
  );
}

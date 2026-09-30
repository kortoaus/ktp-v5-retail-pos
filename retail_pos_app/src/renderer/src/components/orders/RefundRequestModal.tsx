// "Request refund" 모달 (2026-09-24 환불 티켓 스펙 §10.1, R5) — 1366×768, 영문.
// POS 는 환불하지 않는다: 사무실에 요청 티켓만 올린다 ("The office will review and
// process this refund."). 좌: 라인 스테퍼(기본 = 결품 수량) / Whole order / Custom amount,
// 우(≥560px): 사유 · 메모 · 금액 · 키패드. 메모 입력 시 좌측이 키보드로 바뀐다(상단 앵커,
// KeyboardAvoidingView 류 없음). 직원명·단말은 pos_server 가 채운다. requestKey 는 모달
// 열 때 1회 생성(재전송 멱등). viewer 백드롭 버블링 방지를 위해 형제 렌더(zIndex 1600).

import { useMemo, useState, type ReactNode } from "react";
import OnScreenKeyboard from "../OnScreenKeyboard";
import MoneyNumpad from "../Numpads/MoneyNumpad";
import { cn } from "../../libs/cn";
import {
  createRefundRequest,
  type ManualRefundRequestReason,
  type OrderDetail,
} from "../../service/order.service";
import {
  buildRefundRequestPayload,
  clampRefundQty,
  defaultRefundQtys,
  draftAmount,
  makeRequestKey,
  MANUAL_REFUND_REASONS,
  openRequestsWarning,
  REFUND_NOTE_MAX,
  REFUND_REASON_LABELS,
  refundRequestErrorMessage,
  unitRefundAmount,
  validateRefundDraft,
  type RefundAmountMode,
} from "./refund-request-policy";
import { formatMoney } from "./triage-format";

export default function RefundRequestModal({
  detail,
  onClose,
  onSent,
}: {
  detail: OrderDetail;
  onClose: () => void;
  onSent: () => void;
}) {
  const [requestKey] = useState(() => makeRequestKey());
  const [mode, setMode] = useState<RefundAmountMode>("lines");
  const [qtys, setQtys] = useState<Map<number, number>>(() => defaultRefundQtys(detail.lines));
  const [customCents, setCustomCents] = useState("");
  const hasShortfall = useMemo(
    () => [...defaultRefundQtys(detail.lines).values()].some((q) => q > 0),
    [detail.lines],
  );
  const [reason, setReason] = useState<ManualRefundRequestReason | null>(
    hasShortfall ? "PICKING_SHORTFALL" : null,
  );
  const [note, setNote] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [refundable, setRefundable] = useState<number>(detail.payment.refundable ?? detail.payment.capturedAmount ?? 0);

  const draft = {
    mode,
    qtys,
    customCents: parseInt(customCents || "0", 10),
    reason,
    note,
  };
  const amount = draftAmount(draft, detail.lines, refundable);
  const blocker = validateRefundDraft(draft, detail.lines, refundable);
  const warning = openRequestsWarning(detail.refundRequests ?? []);

  function step(lineId: number, delta: number) {
    const line = detail.lines.find((l) => l.id === lineId);
    if (!line) return;
    setMode("lines");
    setQtys((prev) => {
      const next = new Map(prev);
      next.set(lineId, clampRefundQty((prev.get(lineId) ?? 0) + delta, line));
      return next;
    });
  }

  async function send() {
    if (blocker || sending || sent) return;
    setSending(true);
    setError("");
    try {
      const res = await createRefundRequest(
        detail.id,
        buildRefundRequestPayload(draft, requestKey, refundable),
      );
      if (res.ok && res.result) {
        setSent(true);
        onSent();
      } else {
        const next = (res.result as { refundable?: unknown } | null)?.refundable;
        if (typeof next === "number") setRefundable(next);
        setError(refundRequestErrorMessage(res.msg, res.result));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center p-3"
      style={{ zIndex: 1600 }}
      onPointerDown={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-[1340px] h-[calc(100vh-24px)] flex flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 머리 */}
        <div className="h-14 shrink-0 px-4 flex items-center gap-4 border-b border-gray-300">
          <div className="font-bold text-lg">Request refund · {detail.orderNo}</div>
          <div className="text-sm text-gray-500 flex-1">
            The office will review and process this refund.
          </div>
          <div className="text-base">
            Refundable <span className="font-bold">{formatMoney(refundable)}</span>
          </div>
        </div>

        {sent ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="text-2xl font-bold text-emerald-700">
              Request sent to the office. The customer is not refunded until the office processes it.
            </div>
            <div className="text-lg">
              {formatMoney(amount)} · {reason ? REFUND_REASON_LABELS[reason] : ""}
            </div>
            <button
              type="button"
              onPointerDown={onClose}
              className="h-14 px-10 rounded-lg bg-blue-600 text-white text-lg font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* 좌: 라인 / 메모 키보드 */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-gray-200">
              {editingNote ? (
                <div className="flex-1 flex flex-col p-4 gap-3">
                  <div className="text-sm font-semibold text-gray-600">
                    Note {reason === "OTHER" ? "(required)" : "(optional)"} · {note.trim().length}/{REFUND_NOTE_MAX}
                  </div>
                  <div className="min-h-[56px] border border-gray-300 rounded-lg px-3 py-2 text-lg">
                    {note || <span className="text-gray-400">Type a note…</span>}
                  </div>
                  <OnScreenKeyboard
                    value={note}
                    onChange={(v) => setNote(v.slice(0, REFUND_NOTE_MAX))}
                    onEnter={() => setEditingNote(false)}
                    initialLayout="english"
                  />
                  <button
                    type="button"
                    onPointerDown={() => setEditingNote(false)}
                    className="h-12 rounded-lg bg-gray-200 font-bold active:bg-gray-300"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {detail.lines.map((line) => {
                      const q = mode === "lines" ? (qtys.get(line.id) ?? 0) : 0;
                      return (
                        <div
                          key={line.id}
                          className={cn(
                            "h-16 px-4 flex items-center gap-3 border-b border-gray-100",
                            q > 0 && "bg-blue-50",
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-semibold">{line.name_en || line.name_ko}</div>
                            <div className="text-xs text-gray-500">
                              ordered {line.qty}
                              {line.pickedQty != null && ` · picked ${line.pickedQty}`} · {formatMoney(unitRefundAmount(line))} each
                            </div>
                          </div>
                          <button
                            type="button"
                            onPointerDown={() => step(line.id, -1)}
                            className="w-12 h-12 rounded-lg bg-gray-200 text-2xl font-bold active:bg-gray-300"
                          >
                            −
                          </button>
                          <span className="w-10 text-center text-xl font-bold tabular-nums">{q}</span>
                          <button
                            type="button"
                            onPointerDown={() => step(line.id, 1)}
                            className="w-12 h-12 rounded-lg bg-gray-200 text-2xl font-bold active:bg-gray-300"
                          >
                            +
                          </button>
                          <span className="w-24 text-right font-mono">
                            {q > 0 ? formatMoney(q * unitRefundAmount(line)) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="shrink-0 p-3 flex gap-3 border-t border-gray-200">
                    <ModeButton active={mode === "whole"} onPress={() => setMode("whole")}>
                      Whole order ({formatMoney(refundable)})
                    </ModeButton>
                    <ModeButton active={mode === "custom"} onPress={() => setMode("custom")}>
                      Custom amount
                    </ModeButton>
                    <ModeButton active={mode === "lines"} onPress={() => setMode("lines")}>
                      By items
                    </ModeButton>
                  </div>
                  {warning && (
                    <div className="shrink-0 px-4 py-2 text-sm font-semibold text-amber-800 bg-amber-50">
                      {warning}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 우: 사유 · 메모 · 금액 · 키패드 (≥560px) */}
            <div className="w-[560px] shrink-0 flex flex-col p-4 gap-3">
              <div className="text-sm font-semibold text-gray-600">Reason</div>
              <div className="flex gap-2">
                {MANUAL_REFUND_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onPointerDown={() => setReason(r)}
                    className={cn(
                      "flex-1 h-12 rounded-lg border-2 font-bold text-sm",
                      reason === r ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white",
                    )}
                  >
                    {REFUND_REASON_LABELS[r]}
                  </button>
                ))}
              </div>
              <div
                onPointerDown={() => setEditingNote(true)}
                className={cn(
                  "min-h-[48px] rounded-lg border px-3 py-2 cursor-pointer",
                  editingNote ? "border-blue-600" : "border-gray-300",
                )}
              >
                <div className="text-xs text-gray-500">
                  Note {reason === "OTHER" ? "(required)" : "(optional)"}
                </div>
                <div className="truncate">{note || <span className="text-gray-400">Tap to type</span>}</div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-gray-600">Amount</span>
                <span className="text-3xl font-bold tabular-nums">{formatMoney(amount)}</span>
              </div>
              <div className="flex-1 min-h-0">
                {mode === "custom" ? (
                  <MoneyNumpad val={customCents} setVal={(v) => setCustomCents(v.replace(/^0+/, "").slice(0, 7))} />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
                    {mode === "whole"
                      ? "Requests the full refundable amount."
                      : "Amount = selected items × their price. The office can adjust it."}
                  </div>
                )}
              </div>
              {(error || blocker) && (
                <div className={cn("text-sm font-semibold", error ? "text-red-600" : "text-gray-500")}>
                  {error || blocker}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onPointerDown={onClose}
                  className="flex-1 h-14 rounded-lg bg-gray-200 text-lg font-bold active:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={blocker != null || sending}
                  onPointerDown={() => void send()}
                  className="flex-[2] h-14 rounded-lg bg-blue-600 text-white text-lg font-bold disabled:opacity-40"
                >
                  {sending ? "Sending…" : `Send request ${formatMoney(amount)}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPress}
      className={cn(
        "flex-1 h-12 rounded-lg border-2 text-sm font-bold",
        active ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-300 bg-white",
      )}
    >
      {children}
    </button>
  );
}

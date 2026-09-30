// 환불 요청 티켓 — POS 순수 규칙 (2026-09-24 환불 티켓 스펙 §10.1·Q4, R5).
// POS 는 환불하지 않는다: 사무실에 요청 티켓만 올린다. 금액은 서버(crm)가 라인에서
// 재계산하는 것이 정본 — 여기 합산은 표시용(같은 식: qty × (unitPrice + 배달 할증)).
// 런타임 import 0 — node --test 직접 실행.

import { formatMoney, formatPrintedAt } from "./triage-format";
import type {
  ManualRefundRequestReason,
  OrderDetail,
  OrderLine,
  RefundRequest,
  RefundRequestReason,
} from "../../service/order.service";

export const REFUND_TICKET_SCOPE = "refund_ticket";

// 수동 사유 — REJECTED_AFTER_CAPTURE 는 SYSTEM 전용 (crm 400).
export const MANUAL_REFUND_REASONS: readonly ManualRefundRequestReason[] = [
  "PICKING_SHORTFALL",
  "CUSTOMER_REQUEST",
  "OTHER",
];

export const REFUND_REASON_LABELS: Record<RefundRequestReason, string> = {
  REJECTED_AFTER_CAPTURE: "Rejected after charge",
  PICKING_SHORTFALL: "Picking shortfall",
  CUSTOMER_REQUEST: "Customer request",
  OTHER: "Other",
};

export const REFUND_NOTE_MAX = 500;

// "Request refund" 버튼 — refund_ticket 스코프(admin 은 전부 통과) ∧ STRIPE ∧
// 캡처됨(CAPTURED | PARTIALLY_REFUNDED). 그 외 미표시(비활성 아님).
export function canRequestRefund(
  detail: Pick<OrderDetail, "paymentMethod" | "payment">,
  userScopes: readonly string[],
): boolean {
  const scoped = userScopes.includes("admin") || userScopes.includes(REFUND_TICKET_SCOPE);
  if (!scoped) return false;
  if (detail.paymentMethod !== "STRIPE") return false;
  return detail.payment.state === "CAPTURED" || detail.payment.state === "PARTIALLY_REFUNDED";
}

export function unitRefundAmount(
  line: Pick<OrderLine, "unitPrice" | "deliverySurchargePerUnit">,
): number {
  return line.unitPrice + (line.deliverySurchargePerUnit ?? 0);
}

// 스테퍼 기본값 = 결품 수량(qty − pickedQty), 피킹 기록이 없거나 결품 없으면 0.
export function defaultRefundQtys(
  lines: readonly Pick<OrderLine, "id" | "qty" | "pickedQty">[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    const short = line.pickedQty == null ? 0 : Math.max(0, line.qty - line.pickedQty);
    out.set(line.id, Math.min(short, line.qty));
  }
  return out;
}

export function clampRefundQty(qty: number, line: Pick<OrderLine, "qty">): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.min(line.qty, Math.floor(qty)));
}

export function linesRefundAmount(
  lines: readonly Pick<OrderLine, "id" | "unitPrice" | "deliverySurchargePerUnit">[],
  qtys: ReadonlyMap<number, number>,
): number {
  return lines.reduce(
    (sum, line) => sum + (qtys.get(line.id) ?? 0) * unitRefundAmount(line),
    0,
  );
}

export type RefundAmountMode = "lines" | "whole" | "custom";

export type RefundDraft = {
  mode: RefundAmountMode;
  qtys: ReadonlyMap<number, number>;
  customCents: number;
  reason: ManualRefundRequestReason | null;
  note: string;
};

// 요청 금액(표시) — lines = 라인 합, whole = refundable 전액, custom = 키패드 입력.
export function draftAmount(
  draft: RefundDraft,
  lines: readonly Pick<OrderLine, "id" | "unitPrice" | "deliverySurchargePerUnit">[],
  refundable: number,
): number {
  if (draft.mode === "whole") return refundable;
  if (draft.mode === "custom") return draft.customCents;
  return linesRefundAmount(lines, draft.qtys);
}

// 전송 가능 여부 + 막는 이유 (첫 번째 하나만, 버튼 아래 표시).
export function validateRefundDraft(
  draft: RefundDraft,
  lines: readonly Pick<OrderLine, "id" | "unitPrice" | "deliverySurchargePerUnit">[],
  refundable: number,
): string | null {
  const amount = draftAmount(draft, lines, refundable);
  if (amount <= 0) return "Choose items or an amount.";
  if (amount > refundable) return `Only ${formatMoney(refundable)} can still be refunded.`;
  if (!draft.reason) return "Choose a reason.";
  const note = draft.note.trim();
  if (draft.reason === "OTHER" && !note) return "A note is required for Other.";
  if (note.length > REFUND_NOTE_MAX) return `Note is too long (max ${REFUND_NOTE_MAX}).`;
  return null;
}

// crm body — lines 모드는 lines 만(금액 서버 계산), 그 외 amount 만.
export function buildRefundRequestPayload(
  draft: RefundDraft,
  requestKey: string,
  refundable: number,
): {
  requestKey: string;
  reason: ManualRefundRequestReason;
  lines?: { lineId: number; qty: number }[];
  amount?: number;
  note?: string;
} {
  if (!draft.reason) throw new Error("reason required");
  const note = draft.note.trim();
  const base = {
    requestKey,
    reason: draft.reason,
    ...(note ? { note } : {}),
  };
  if (draft.mode === "lines") {
    const lines = [...draft.qtys.entries()]
      .filter(([, qty]) => qty > 0)
      .map(([lineId, qty]) => ({ lineId, qty }));
    return { ...base, lines };
  }
  return { ...base, amount: draft.mode === "whole" ? refundable : draft.customCents };
}

// 멱등키 — 모달 열 때 1회. crypto.randomUUID 는 보안 컨텍스트 전용이라
// getRandomValues(항상 사용 가능)로 v4 를 만든다.
export function makeRequestKey(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const b = random(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 뷰어 "Refund requests" 블록 한 줄 (§10.1).
export function refundRequestLine(req: RefundRequest): { text: string; tone: "open" | "done" | "declined" } {
  const reason = REFUND_REASON_LABELS[req.reason] ?? req.reason;
  if (req.status === "COMPLETED") {
    const amount = req.processedAmount ?? req.requestedAmount;
    const when = req.processedAt ? ` · ${formatPrintedAt(new Date(req.processedAt))}` : "";
    return { text: `Refunded ${formatMoney(amount)} · ${reason}${when}`, tone: "done" };
  }
  if (req.status === "DECLINED") {
    return {
      text: `Declined ${formatMoney(req.requestedAmount)} · ${reason}${req.declineReason ? ` — ${req.declineReason}` : ""}`,
      tone: "declined",
    };
  }
  const by =
    req.source === "SYSTEM"
      ? "System"
      : [req.requestedByName, req.sourceTerminal].filter(Boolean).join(" @ ") || req.source;
  const state = req.processing ? "Processing…" : "Waiting for office";
  return {
    text: `Requested ${formatMoney(req.requestedAmount)} · ${reason} · by ${by} · ${state}`,
    tone: "open",
  };
}

// 모달 경고 — 이미 열린 요청 (중복 요청 방지 안내, 차단은 아님).
export function openRequestsWarning(requests: readonly RefundRequest[]): string | null {
  const open = requests.filter((r) => r.status === "OPEN");
  if (open.length === 0) return null;
  const parts = open.map(
    (r) => `${formatMoney(r.requestedAmount)} (${REFUND_REASON_LABELS[r.reason] ?? r.reason})`,
  );
  return `${open.length === 1 ? "Another request is" : "Other requests are"} open: ${parts.join(", ")}`;
}

// crm 오류 코드 → 모달 빨간 줄.
export function refundRequestErrorMessage(msg: string, result: unknown): string {
  if (msg === "AMOUNT_EXCEEDS_REFUNDABLE") {
    const refundable = (result as { refundable?: unknown } | null)?.refundable;
    return typeof refundable === "number"
      ? `Only ${formatMoney(refundable)} can still be refunded.`
      : "The amount is more than can still be refunded.";
  }
  if (msg === "NOT_REFUNDABLE") return "This order has no charged amount left to refund.";
  if (msg === "NOT_ONLINE_PAID") return "In-store payments are refunded at the till, not here.";
  if (msg === "REQUEST_KEY_CONFLICT") return "Request conflict — close and try again.";
  return msg || "Failed to send the request.";
}

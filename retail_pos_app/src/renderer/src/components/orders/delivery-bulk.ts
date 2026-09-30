// Delivery Tomorrow/Today 작업 줄 — 일괄 Schedule/Dispatch 순수 규칙
// (2026-09-24 트리아지 스펙 §6.5, 러너 libs/order/delivery-run.ts 이식).
//
// - Schedule & charge 대상 = 선택 중 ACCEPTED 만 (카드 캡처). Dispatch = 선택 중 SCHEDULED.
// - 확인 다이얼로그 필수: schedule = 건수 + 총액(선택 행 total 의 표시 합산, 재계산 아님),
//   dispatch = 건수.
// - 실행은 10건 청크 순차 (pos_server→crm 30s 타임아웃 — schedule 은 건마다 Stripe 캡처).
//   묶음 요청 자체가 실패하면 그 묶음 전 행을 "확인 필요"로 둔다(서버에서 일부 처리됐을 수 있음).
// 런타임 import 0 — node --test 직접 실행.

import { formatMoney } from "./triage-format";
import type {
  OrderBulkItemInput,
  OrderBulkItemResult,
  OrderStatus,
  OrderSummary,
} from "../../service/order.service";

export const BULK_CHUNK_SIZE = 10;

export type BulkKind = "schedule" | "dispatch";

type BulkRow = Pick<OrderSummary, "id" | "status" | "fulfillment" | "version" | "total">;

const TARGET_STATUS: Record<BulkKind, OrderStatus> = {
  schedule: "ACCEPTED",
  dispatch: "SCHEDULED",
};

// 선택 순서가 아니라 목록 순서를 따른다 (rows 순서 그대로).
export function bulkTargets<T extends BulkRow>(
  rows: readonly T[],
  selectedIds: ReadonlySet<number>,
  kind: BulkKind,
): T[] {
  return rows.filter(
    (row) =>
      selectedIds.has(row.id) &&
      row.fulfillment === "DELIVERY" &&
      row.status === TARGET_STATUS[kind],
  );
}

// "Select to schedule / dispatch" — 해당 상태 행 전부.
export function selectableIds(rows: readonly BulkRow[], kind: BulkKind): number[] {
  return rows
    .filter((row) => row.fulfillment === "DELIVERY" && row.status === TARGET_STATUS[kind])
    .map((row) => row.id);
}

export function sumTotals(rows: readonly Pick<OrderSummary, "total">[]): number {
  return rows.reduce((sum, row) => sum + row.total, 0);
}

export type BulkConfirmText = { title: string; lines: string[]; confirmLabel: string };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function scheduleConfirmText(count: number, totalCents: number): BulkConfirmText {
  return {
    title: `Charge ${count} ${plural(count, "card", "cards")} now?`,
    lines: [
      `Total ${formatMoney(totalCents)} (AUD)`,
      "Customers are charged and told their delivery day.",
    ],
    confirmLabel: `Charge ${count} ${plural(count, "order", "orders")}`,
  };
}

export function dispatchConfirmText(count: number): BulkConfirmText {
  return {
    title: `Dispatch ${count} ${plural(count, "order", "orders")}?`,
    lines: ['Customers are told "Arriving today".'],
    confirmLabel: `Dispatch ${count} ${plural(count, "order", "orders")}`,
  };
}

// 작업 줄 요약 — 화면에 보이는(흐리지 않은) 행 기준.
export function tomorrowSummaryText(
  dayLabel: string,
  rows: readonly Pick<OrderSummary, "status">[],
): string {
  const toSchedule = rows.filter((r) => r.status === "ACCEPTED").length;
  const scheduled = rows.filter((r) => r.status === "SCHEDULED").length;
  return `${dayLabel} · ${rows.length} ${plural(rows.length, "order", "orders")} · ${toSchedule} to schedule · ${scheduled} scheduled`;
}

export function todaySummaryText(rows: readonly Pick<OrderSummary, "status">[]): string {
  const notScheduled = rows.filter((r) => r.status === "ACCEPTED").length;
  const toDispatch = rows.filter((r) => r.status === "SCHEDULED").length;
  return `Today · ${rows.length} ${plural(rows.length, "order", "orders")} · ${notScheduled} not scheduled · ${toDispatch} to dispatch`;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// crm 결제 사유 코드 → 현장 문구 (crm 스펙 §6.2). 뷰어 단건 전이와 공용.
export function paymentFailureMessage(msg: string, result: unknown): string | null {
  if (msg === "PAYMENT_CAPTURE_FAILED") {
    const reason =
      typeof result === "string"
        ? result
        : (result as { reason?: unknown } | null)?.reason;
    if (reason === "AUTH_EXPIRED") {
      return "Card hold expired — this order can't be charged. Reject it and ask the customer to re-order.";
    }
    return `Card charge failed${typeof reason === "string" && reason ? ` (${reason})` : ""}. The order was not scheduled.`;
  }
  if (msg === "PAYMENT_PROVIDER_UNAVAILABLE") {
    return "Payment service unavailable — try again.";
  }
  if (msg === "STRIPE_NOT_CONFIGURED") {
    return "Online payment isn't configured.";
  }
  return null;
}

// 일괄 건별 실패 코드 → 현장 문구.
export function describeTransitionFailure(code: string, detail?: unknown): string {
  const payment = paymentFailureMessage(code, detail);
  if (payment) return payment;
  if (code === "TRANSITION_CONFLICT") return "Order was updated elsewhere — refresh and check it.";
  if (code === "NOT_FOR_CLICK_AND_COLLECT") return "Not a delivery order.";
  if (code === "INTERNAL_ERROR") return "Server error — refresh and check this order.";
  return typeof detail === "string" && detail ? `${code} (${detail})` : code;
}

export type BulkItemResult =
  | { ok: true; label: string; status: OrderStatus; version: number }
  | { ok: false; message: string };

const SUCCESS_LABELS: Record<BulkKind, string> = {
  schedule: "Scheduled",
  dispatch: "Dispatched",
};

export type BulkCall = (
  kind: BulkKind,
  orders: OrderBulkItemInput[],
) => Promise<{
  ok: boolean;
  msg: string;
  result: { results: OrderBulkItemResult[] } | null;
}>;

/** 행 id → 결과 (입력한 모든 행에 정확히 1개). onProgress(done, total) 은 청크마다. */
export async function runDeliveryBulk(
  kind: BulkKind,
  rows: readonly Pick<OrderSummary, "id" | "version">[],
  call: BulkCall,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, BulkItemResult>> {
  const results = new Map<number, BulkItemResult>();
  let done = 0;
  for (const part of chunk(rows, BULK_CHUNK_SIZE)) {
    const res = await call(
      kind,
      part.map((row) => ({ id: row.id, version: row.version })),
    );
    const returned = new Map(
      (res.ok && res.result ? res.result.results : []).map((r) => [r.id, r]),
    );
    for (const row of part) {
      const r = returned.get(row.id);
      if (!r) {
        results.set(row.id, {
          ok: false,
          message: `${res.ok ? "No result returned" : res.msg || "Request failed"} — refresh and check this order.`,
        });
      } else if (r.ok) {
        results.set(row.id, {
          ok: true,
          label: SUCCESS_LABELS[kind],
          status: r.status,
          version: r.version,
        });
      } else {
        results.set(row.id, { ok: false, message: describeTransitionFailure(r.code, r.detail) });
      }
    }
    done += part.length;
    onProgress?.(done, rows.length);
  }
  return results;
}

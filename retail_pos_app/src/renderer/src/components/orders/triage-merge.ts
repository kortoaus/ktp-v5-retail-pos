// 트리아지 목록 위치 유지 병합 — 순수 (2026-09-24 트리아지 스펙 §6.3, 러너
// delivery-run.ts mergeKeepingPositions 이식·확장). 오너 룰 "저장 후 위치 유지":
//
// - 재조회 결과로 기존 행은 **제자리에서 내용만** 갱신한다.
// - 버킷을 벗어난 행은 사라지지 않고 흐리게(gone) + 결과 태그로 남는다
//   (이 단말이 방금 한 전이의 결과 status 를 알면 "→ Ready" 등, 모르면
//   "Moved by another till").
// - 새 행은 **맨 아래**에 NEW 강조로 붙는다.
// - 서버 순서로 전체 교체는 수동 ⟳ · 칩/버킷 전환 때만 (replaceTriageRows).
// 런타임 import 0 — node --test 직접 실행.

import { goneLabelForStatus } from "./triage-format";
import type { OrderStatus } from "../../service/order.service";

export type TriageRowState<T> = {
  order: T;
  gone: boolean;
  goneLabel: string | null;
  isNew: boolean;
};

export function replaceTriageRows<T>(fresh: readonly T[]): TriageRowState<T>[] {
  return fresh.map((order) => ({ order, gone: false, goneLabel: null, isNew: false }));
}

/**
 * @param knownStatus 이 단말이 방금 전이시킨 주문의 결과 status (뷰어·일괄 응답).
 */
export function mergeTriageRows<T extends { id: number; status: OrderStatus }>(
  prev: readonly TriageRowState<T>[],
  fresh: readonly T[],
  knownStatus: ReadonlyMap<number, OrderStatus> = new Map(),
): TriageRowState<T>[] {
  const freshById = new Map(fresh.map((order) => [order.id, order]));
  const prevIds = new Set(prev.map((row) => row.order.id));
  const merged: TriageRowState<T>[] = prev.map((row) => {
    const next = freshById.get(row.order.id);
    if (next) {
      return { order: next, gone: false, goneLabel: null, isNew: row.isNew };
    }
    const status = knownStatus.get(row.order.id);
    return {
      order: status ? { ...row.order, status } : row.order,
      gone: true,
      goneLabel: row.gone && row.goneLabel ? row.goneLabel : goneLabelForStatus(status),
      isNew: row.isNew,
    };
  });
  for (const order of fresh) {
    if (!prevIds.has(order.id)) {
      merged.push({ order, gone: false, goneLabel: null, isNew: true });
    }
  }
  return merged;
}

// 이 단말의 전이 결과를 목록에 즉시 반영 (재조회 전) — 같은 자리, 내용만.
export function patchTriageRow<T extends { id: number }>(
  rows: readonly TriageRowState<T>[],
  id: number,
  patch: Partial<T>,
): TriageRowState<T>[] {
  return rows.map((row) =>
    row.order.id === id ? { ...row, order: { ...row.order, ...patch } } : row,
  );
}

// 인쇄 이벤트 카운트 헬퍼 — 순수 함수 (슬라이스 C).
// 정본은 crm 의 events[]: PICKLIST_PRINTED / LABEL_PRINTED.
// LABEL_PRINTED 의 note 는 `line:<lineId> <name_en>` 형 — 방어적으로
// "line:" 접두 + 양의 정수 + (공백 또는 끝) 만 인정하고 나머지는 무시한다.

import type { OrderEvent } from "../../service/order.service";

export const PICKLIST_PRINTED_EVENT = "PICKLIST_PRINTED";
export const LABEL_PRINTED_EVENT = "LABEL_PRINTED";

export function countPicklistPrinted(events: readonly OrderEvent[]): number {
  return events.filter((e) => e.type === PICKLIST_PRINTED_EVENT).length;
}

// note → lineId. 형식 불일치(접두 없음, 숫자 아님, 0 이하)는 null.
export function parseLabelPrintedLineId(note: string): number | null {
  const match = /^line:(\d+)(?:\s|$)/.exec(note);
  if (!match) return null;
  const lineId = Number(match[1]);
  if (!Number.isInteger(lineId) || lineId <= 0) return null;
  return lineId;
}

// events → lineId 별 LABEL_PRINTED 카운트 맵.
export function buildLabelPrintedCounts(
  events: readonly OrderEvent[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (event.type !== LABEL_PRINTED_EVENT) continue;
    const lineId = parseLabelPrintedLineId(event.note ?? "");
    if (lineId == null) continue;
    counts.set(lineId, (counts.get(lineId) ?? 0) + 1);
  }
  return counts;
}

import db from "../../libs/db";
import apiService from "../../libs/cloud.api";

// ══════════════════════════════════════════════════════════════
// D3 — 멤버 익명화 이벤트 pull (crm-server specs/2026-09-01-member-deletion-design.md §5 D3)
//
// CRM 회원 탈퇴 시 api-server 가 `MemberAnonymizeEvent` 큐에 이벤트를 누적
// 적재한다(삭제 없음, id ASC). POS 는 cloud-migrate(카탈로그 싱크) 완료 후와
// 서버 부팅 시 이 큐를 afterId 커서부터 페이지 단위로 pull 해, 로컬
// `SaleInvoice` 의 PII 스냅샷(memberName, memberPhoneLast4)을 null 로
// 익명화한다. memberId(uuid)는 비식별 참조라 보존한다 (스펙 결정 3·4).
//
// 커서는 `SyncCursor` KV(key = "member-anonymize:afterId")에 저장.
// **익명화 UPDATE 는 멱등** — null 로 덮는 것뿐이라 커서가 유실되거나
// 되감겨 전체 이벤트를 처음부터 재생해도 무해하다. 그래서 순서는
// UPDATE 먼저 → 커서 전진: 중간 실패 시 커서가 안 나가고, 다음 싱크가
// 같은 페이지를 다시 적용한다 (at-least-once).
//
// 실패(네트워크/!ok)는 로그만 남기고 중단 — 커서 미전진, 다음 트리거
// (판매와 무관: cloud-migrate 또는 서버 부팅)에서 재시도.
// ══════════════════════════════════════════════════════════════

export const MEMBER_ANONYMIZE_CURSOR_KEY = "member-anonymize:afterId";

// api-server 계약: GET /device/member-anonymize-events?afterId=&limit=
// → { ok, result: { events: [{ id, memberId }], nextAfterId } }, id ASC.
export const MEMBER_ANONYMIZE_PAGE_LIMIT = 200;

// 폭주 가드 — 한 스윕에서 도는 최대 페이지 수. 이벤트는 누적 보존이므로
// 신규 매장 초회 재생이 커도 (limit × cap) 이면 충분하고, 남으면 다음
// 트리거가 이어서 따라잡는다.
const MAX_PAGES_PER_SWEEP = 500;

const tag = "[member-anonymize]";

export type MemberAnonymizeEvent = {
  id: number;
  memberId: string;
};

export type MemberAnonymizePullResult = {
  ok: boolean;
  msg?: string;
  result?: {
    events?: MemberAnonymizeEvent[] | null;
    nextAfterId?: number | null;
  } | null;
};

// ── 순수 함수 (단위테스트 대상) ────────────────────────────────

// 이벤트 → UPDATE 대상 memberId 목록. 중복 제거, 빈/누락 id 방어.
export function extractAnonymizeTargets(
  events: MemberAnonymizeEvent[],
): string[] {
  const ids = new Set<string>();
  for (const ev of events) {
    if (typeof ev.memberId === "string" && ev.memberId.length > 0) {
      ids.add(ev.memberId);
    }
  }
  return [...ids];
}

// 다음 커서 값. 서버의 nextAfterId 를 신뢰하되, 누락 시 페이지 마지막
// 이벤트 id 로 폴백한다 (id ASC 계약). 어느 쪽도 없으면 null = 전진 없음.
export function resolveNextAfterId(
  page: NonNullable<MemberAnonymizePullResult["result"]>,
  currentAfterId: number,
): number | null {
  const events = page.events ?? [];
  const fromServer = page.nextAfterId;
  if (typeof fromServer === "number" && fromServer > currentAfterId) {
    return fromServer;
  }
  if (events.length > 0) {
    const maxId = Math.max(...events.map((ev) => ev.id));
    if (maxId > currentAfterId) return maxId;
  }
  return null;
}

// ── 주입식 스윕 (기본 deps = Prisma + apiService) ──────────────

export interface MemberAnonymizeDeps {
  getCursor(): Promise<number>;
  setCursor(value: number): Promise<void>;
  pullEvents(afterId: number, limit: number): Promise<MemberAnonymizePullResult>;
  // updateMany — 변경 행 수를 돌려준다. 멱등(재실행 무해).
  anonymizeInvoices(memberIds: string[]): Promise<number>;
}

export const defaultMemberAnonymizeDeps: MemberAnonymizeDeps = {
  async getCursor() {
    const row = await db.syncCursor.findUnique({
      where: { key: MEMBER_ANONYMIZE_CURSOR_KEY },
    });
    return row?.value ?? 0;
  },
  async setCursor(value: number) {
    await db.syncCursor.upsert({
      where: { key: MEMBER_ANONYMIZE_CURSOR_KEY },
      create: { key: MEMBER_ANONYMIZE_CURSOR_KEY, value },
      update: { value },
    });
  },
  async pullEvents(afterId: number, limit: number) {
    return apiService.get<{
      events: MemberAnonymizeEvent[];
      nextAfterId: number | null;
    }>("/device/member-anonymize-events", { afterId, limit });
  },
  async anonymizeInvoices(memberIds: string[]) {
    const { count } = await db.saleInvoice.updateMany({
      where: { memberId: { in: memberIds } },
      data: { memberName: null, memberPhoneLast4: null },
    });
    return count;
  },
};

let memberAnonymizeSweepRunning = false;

export async function syncMemberAnonymizeEvents(
  deps: MemberAnonymizeDeps = defaultMemberAnonymizeDeps,
): Promise<{ pages: number; events: number; invoicesUpdated: number }> {
  if (memberAnonymizeSweepRunning) {
    return { pages: 0, events: 0, invoicesUpdated: 0 };
  }
  memberAnonymizeSweepRunning = true;

  let pages = 0;
  let totalEvents = 0;
  let invoicesUpdated = 0;

  try {
    let afterId = await deps.getCursor();

    for (let i = 0; i < MAX_PAGES_PER_SWEEP; i++) {
      const res = await deps.pullEvents(afterId, MEMBER_ANONYMIZE_PAGE_LIMIT);

      if (!res.ok || !res.result) {
        // 실패 — 커서 미전진, 다음 트리거가 같은 afterId 부터 재시도.
        console.error(
          `${tag} pull failed at afterId=${afterId}: ${res.msg ?? "no msg"}`,
        );
        break;
      }

      const events = res.result.events ?? [];
      if (events.length === 0) break; // caught up — no-op

      // UPDATE 먼저(멱등) → 커서 전진. setCursor 실패 시 재생돼도 무해.
      const targets = extractAnonymizeTargets(events);
      if (targets.length > 0) {
        invoicesUpdated += await deps.anonymizeInvoices(targets);
      }

      pages++;
      totalEvents += events.length;

      const next = resolveNextAfterId(res.result, afterId);
      if (next == null) {
        // 방어 — 계약 위반(전진 불가) 페이지면 무한 루프 대신 중단.
        console.error(
          `${tag} no cursor advance from afterId=${afterId} — stopping sweep`,
        );
        break;
      }
      await deps.setCursor(next);
      afterId = next;
    }

    if (totalEvents > 0) {
      console.log(
        `${tag} ${totalEvents} events / ${pages} pages applied, ${invoicesUpdated} invoices anonymized`,
      );
    }
  } finally {
    memberAnonymizeSweepRunning = false;
  }

  return { pages, events: totalEvents, invoicesUpdated };
}

export function triggerSyncMemberAnonymizeEvents() {
  // fire-and-forget — 업싱크 트리거 관례 (호출측은 await 하지 않는다).
  syncMemberAnonymizeEvents().catch((e) => {
    console.error(`${tag} syncMemberAnonymizeEvents threw:`, e);
  });
}

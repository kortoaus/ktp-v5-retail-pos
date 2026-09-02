import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAnonymizeTargets,
  resolveNextAfterId,
  syncMemberAnonymizeEvents,
  MemberAnonymizeDeps,
  MemberAnonymizeEvent,
  MemberAnonymizePullResult,
} from "./cloud.member-anonymize.service";

// ── 테스트 하네스: 인메모리 deps ───────────────────────────────

type Page = MemberAnonymizePullResult;

function makeDeps(pages: Page[], initialCursor = 0) {
  const calls: { afterId: number; limit: number }[] = [];
  const anonymized: string[][] = [];
  const cursorWrites: number[] = [];
  let cursor = initialCursor;
  let pageIdx = 0;

  const deps: MemberAnonymizeDeps = {
    async getCursor() {
      return cursor;
    },
    async setCursor(value: number) {
      cursor = value;
      cursorWrites.push(value);
    },
    async pullEvents(afterId: number, limit: number) {
      calls.push({ afterId, limit });
      const page = pages[pageIdx] ?? {
        ok: true,
        result: { events: [], nextAfterId: afterId },
      };
      pageIdx++;
      return page;
    },
    async anonymizeInvoices(memberIds: string[]) {
      anonymized.push(memberIds);
      return memberIds.length; // 1 invoice per member for the test
    },
  };

  return {
    deps,
    calls,
    anonymized,
    cursorWrites,
    getCursor: () => cursor,
  };
}

function ev(id: number, memberId: string): MemberAnonymizeEvent {
  return { id, memberId };
}

// ── 순수 함수 ─────────────────────────────────────────────────

test("extractAnonymizeTargets dedupes and drops empty ids", () => {
  const targets = extractAnonymizeTargets([
    ev(1, "m-a"),
    ev(2, "m-b"),
    ev(3, "m-a"), // duplicate member (re-signup + re-delete)
    ev(4, ""), // defensive: never a valid target
  ]);
  assert.deepEqual(targets.sort(), ["m-a", "m-b"]);
});

test("resolveNextAfterId prefers server nextAfterId, falls back to max event id", () => {
  assert.equal(
    resolveNextAfterId({ events: [ev(5, "m")], nextAfterId: 7 }, 3),
    7,
  );
  // nextAfterId 누락 → 마지막 이벤트 id 폴백
  assert.equal(
    resolveNextAfterId({ events: [ev(5, "m"), ev(9, "n")], nextAfterId: null }, 3),
    9,
  );
  // 전진 불가(계약 위반) → null
  assert.equal(resolveNextAfterId({ events: [], nextAfterId: null }, 3), null);
  assert.equal(resolveNextAfterId({ events: [ev(2, "m")], nextAfterId: 2 }, 3), null);
});

// ── 스윕 ─────────────────────────────────────────────────────

test("sweep pages through events and advances cursor per page", async () => {
  const h = makeDeps(
    [
      { ok: true, result: { events: [ev(1, "m-1"), ev(2, "m-2")], nextAfterId: 2 } },
      { ok: true, result: { events: [ev(3, "m-3")], nextAfterId: 3 } },
      { ok: true, result: { events: [], nextAfterId: 3 } },
    ],
    0,
  );

  const summary = await syncMemberAnonymizeEvents(h.deps);

  assert.deepEqual(
    h.calls.map((c) => c.afterId),
    [0, 2, 3],
  );
  assert.deepEqual(h.cursorWrites, [2, 3]);
  assert.equal(h.getCursor(), 3);
  assert.equal(summary.pages, 2);
  assert.equal(summary.events, 3);
  assert.equal(summary.invoicesUpdated, 3);
});

test("sweep resumes from stored cursor", async () => {
  const h = makeDeps(
    [{ ok: true, result: { events: [], nextAfterId: 42 } }],
    42,
  );

  await syncMemberAnonymizeEvents(h.deps);

  assert.deepEqual(h.calls, [{ afterId: 42, limit: 200 }]);
});

test("empty response is a no-op — no update, no cursor write", async () => {
  const h = makeDeps([{ ok: true, result: { events: [], nextAfterId: 0 } }], 0);

  const summary = await syncMemberAnonymizeEvents(h.deps);

  assert.deepEqual(h.anonymized, []);
  assert.deepEqual(h.cursorWrites, []);
  assert.deepEqual(summary, { pages: 0, events: 0, invoicesUpdated: 0 });
});

test("update targets are the deduped memberIds of the page", async () => {
  const h = makeDeps(
    [
      {
        ok: true,
        result: {
          events: [ev(1, "m-1"), ev(2, "m-1"), ev(3, "m-2")],
          nextAfterId: 3,
        },
      },
      { ok: true, result: { events: [], nextAfterId: 3 } },
    ],
    0,
  );

  await syncMemberAnonymizeEvents(h.deps);

  assert.equal(h.anonymized.length, 1);
  assert.deepEqual(h.anonymized[0].sort(), ["m-1", "m-2"]);
});

test("pull failure stops the sweep without advancing the cursor", async () => {
  const h = makeDeps(
    [
      { ok: true, result: { events: [ev(1, "m-1")], nextAfterId: 1 } },
      { ok: false, msg: "Network Error" }, // page 2 fails
    ],
    0,
  );

  const summary = await syncMemberAnonymizeEvents(h.deps);

  // 1페이지는 적용+전진, 실패한 2페이지에서 커서 정지 → 다음 스윕이 afterId=1 재시도.
  assert.deepEqual(h.cursorWrites, [1]);
  assert.equal(h.getCursor(), 1);
  assert.equal(summary.pages, 1);
  assert.equal(summary.events, 1);
});

test("failed page applies no update", async () => {
  const h = makeDeps([{ ok: false, msg: "Server Error" }], 7);

  await syncMemberAnonymizeEvents(h.deps);

  assert.deepEqual(h.anonymized, []);
  assert.deepEqual(h.cursorWrites, []);
  assert.equal(h.getCursor(), 7);
});

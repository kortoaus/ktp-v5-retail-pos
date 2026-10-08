// T-17 / F-16 — decision for an exchange answer.
// Run: node --experimental-strip-types --test src/renderer/src/libs/customer-voucher-issue.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

const { decideIssueAnswer, memberPointsAfterIssue } = await import("./customer-voucher-issue.ts");

const voucher = { id: 9, serial: "CV-ABC123", balance: 1000 };

test("fresh issue → select the voucher with the new member points", () => {
  const d = decideIssueAnswer({ ok: true, result: { voucher, memberPoints: 500, replayed: false } });
  assert.deepEqual(d, { action: "select", voucher, memberPoints: 500 });
});

test("answer without replayed flag (older crm) → select, as before", () => {
  const d = decideIssueAnswer({ ok: true, result: { voucher, memberPoints: 500 } });
  assert.equal(d.action, "select");
});

test("replayed issue → no auto-select; one recovery notice naming the serial", () => {
  const d = decideIssueAnswer({ ok: true, result: { voucher, memberPoints: null, replayed: true } });
  assert.deepEqual(d, {
    action: "recovered",
    notice: "Earlier exchange recovered — voucher CV-ABC123",
    memberPoints: null,
  });
  assert.equal("voucher" in d, false, "a recovered voucher is never handed to onSelect");
});

test("failure → error with the server message or a default", () => {
  assert.deepEqual(decideIssueAnswer({ ok: false, msg: "Insufficient points", result: null }), {
    action: "error",
    message: "Insufficient points",
  });
  assert.deepEqual(decideIssueAnswer({ ok: false, result: null }), {
    action: "error",
    message: "Failed to issue voucher",
  });
});

test("F-17: the decision carries the member points on both ok branches", () => {
  const fresh = decideIssueAnswer({ ok: true, result: { voucher, memberPoints: 500, replayed: false } });
  const replay = decideIssueAnswer({ ok: true, result: { voucher, memberPoints: 250, replayed: true } });
  assert.equal(fresh.memberPoints, 500);
  assert.equal(replay.action, "recovered");
  assert.equal(replay.memberPoints, 250);
});

test("F-17: points present → no member re-fetch", async () => {
  let calls = 0;
  const points = await memberPointsAfterIssue(250, async () => (calls++, 999));
  assert.equal(points, 250);
  assert.equal(calls, 0);
});

test("F-17: replay with memberPoints null → member re-fetched", async () => {
  let calls = 0;
  const points = await memberPointsAfterIssue(null, async () => (calls++, 120));
  assert.equal(points, 120);
  assert.equal(calls, 1);
});

test("F-17: re-fetch failure → null (caller keeps what it shows)", async () => {
  assert.equal(await memberPointsAfterIssue(null, async () => { throw new Error("offline"); }), null);
  assert.equal(await memberPointsAfterIssue(null, async () => null), null);
});

// T-17 / F-16 — decision for an exchange answer.
// Run: node --experimental-strip-types --test src/renderer/src/libs/customer-voucher-issue.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

const {
  decideIssueAnswer,
  memberPointsAfterIssue,
  CUSTOMER_VOUCHER_TIERS,
  affordableVoucherTiers,
  voucherTierShortfall,
  canExchangePoints,
  formatVoucherPoints,
  voucherTierRowLabel,
  voucherTierShortfallLabel,
  voucherIssueConfirmText,
  pendingVoucherIssueFromAttempt,
  pendingVoucherIssueLabel,
  voucherExchangeStep,
  voucherResumeText,
  PENDING_EXCHANGE_NOTICE,
} = await import("./customer-voucher-issue.ts");

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

// retail-delivery D-24 (T-17) — four tiers, affordability, shortfall, texts, attempt key.

const [T10, T25, T50, T100] = CUSTOMER_VOUCHER_TIERS;

test("D-24: the four tiers — cents and points at 100 P per $1, no bonus", () => {
  assert.deepEqual(CUSTOMER_VOUCHER_TIERS, [
    { amount: 1000, points: 1000, label: "$10" },
    { amount: 2500, points: 2500, label: "$25" },
    { amount: 5000, points: 5000, label: "$50" },
    { amount: 10000, points: 10000, label: "$100" },
  ]);
});

test("D-24: affordableVoucherTiers — tiers the balance covers, smallest first", () => {
  assert.deepEqual(affordableVoucherTiers(0), []);
  assert.deepEqual(affordableVoucherTiers(999), []);
  assert.deepEqual(affordableVoucherTiers(1000), [T10]);
  assert.deepEqual(affordableVoucherTiers(1200), [T10]);
  assert.deepEqual(affordableVoucherTiers(2500), [T10, T25]);
  assert.deepEqual(affordableVoucherTiers(9999), [T10, T25, T50]);
  assert.deepEqual(affordableVoucherTiers(10000), [T10, T25, T50, T100]);
  assert.deepEqual(affordableVoucherTiers(123456), [T10, T25, T50, T100]);
  assert.deepEqual(affordableVoucherTiers(-5), []);
  assert.deepEqual(affordableVoucherTiers(Number.NaN), [], "an unknown balance covers nothing");
});

test("D-24: voucherTierShortfall — points still needed, 0 when affordable", () => {
  assert.equal(voucherTierShortfall(1200, T10), 0);
  assert.equal(voucherTierShortfall(1200, T25), 1300);
  assert.equal(voucherTierShortfall(1200, T50), 3800);
  assert.equal(voucherTierShortfall(1200, T100), 8800);
  assert.equal(voucherTierShortfall(10000, T100), 0);
  assert.equal(voucherTierShortfall(Number.NaN, T25), 2500);
});

test("D-24: canExchangePoints keeps meaning 'can afford the smallest tier'", () => {
  assert.equal(canExchangePoints(999), false);
  assert.equal(canExchangePoints(1000), true);
  assert.equal(canExchangePoints(Number.NaN), false);
});

test("D-24: row, shortfall and point labels", () => {
  assert.equal(voucherTierRowLabel(T25), "$25 · 2,500 P");
  assert.equal(voucherTierRowLabel(T100), "$100 · 10,000 P");
  assert.equal(voucherTierShortfallLabel(1000, T25), "needs 1,500 P more");
  assert.equal(formatVoucherPoints(1234567), "1,234,567 P");
  assert.equal(formatVoucherPoints(0), "0 P");
});

test("D-24: confirmation 1 (amount, deduction, balance after) and confirmation 2 (irreversible)", () => {
  const { first, second } = voucherIssueConfirmText(T25, 3734);
  assert.equal(
    [first.title, ...first.lines].join(" "),
    "Issue a $25 voucher? 2,500 P will be deducted. Member balance after: 1,234 P",
  );
  assert.equal([second.title, ...second.lines].join(" "), "This cannot be undone. Issue the $25 voucher now?");
  assert.equal(second.confirmLabel, "Issue $25");
});

test("D-24: the exchange attempt key is one per member — cv-issue:<memberId>", async () => {
  const { customerVoucherIssueAttemptKey } = await import("./operation-id.ts");
  assert.equal(customerVoucherIssueAttemptKey("member-1"), "cv-issue:member-1");
  assert.notEqual(customerVoucherIssueAttemptKey("member-1"), customerVoucherIssueAttemptKey("member-2"));
});

test("D-24: pending exchange from a stored attempt", () => {
  assert.equal(pendingVoucherIssueFromAttempt(null), null);
  assert.deepEqual(pendingVoucherIssueFromAttempt({ payload: { amount: 2500 } }), { amount: 2500 });
  assert.deepEqual(pendingVoucherIssueFromAttempt({}), { amount: undefined }, "previous-release record");
  assert.deepEqual(pendingVoucherIssueFromAttempt({ payload: { amount: "2500" } }), { amount: undefined });
  assert.deepEqual(pendingVoucherIssueFromAttempt({ payload: { amount: 0 } }), { amount: undefined });
});

test("D-24: step resolution — pending → finish-previous step; none → tier list", () => {
  assert.deepEqual(voucherExchangeStep(null), { kind: "tiers" });
  assert.deepEqual(voucherExchangeStep({ amount: 5000 }), { kind: "resume", amount: 5000, label: "$50" });
  assert.deepEqual(voucherExchangeStep({ amount: undefined }), {
    kind: "resume",
    amount: undefined,
    label: "$10 (previous version)",
  });
});

test("D-24: finish-previous texts and the reopen notice", () => {
  assert.equal(pendingVoucherIssueLabel({ amount: 10000 }), "$100");
  const text = voucherResumeText({ amount: 2500 });
  assert.equal(text.title, "Finish previous exchange");
  assert.equal(text.lines[0], "A $25 voucher exchange was sent but not confirmed.");
  assert.equal(text.confirmLabel, "Continue");
  assert.equal(voucherResumeText({ amount: undefined }).lines[0], "A $10 (previous version) voucher exchange was sent but not confirmed.");
  assert.equal(PENDING_EXCHANGE_NOTICE, "Previous exchange not confirmed — finish it first");
});

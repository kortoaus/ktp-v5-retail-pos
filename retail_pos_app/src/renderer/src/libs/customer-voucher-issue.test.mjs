// T-17 / F-16 — decision for an exchange answer.
// Run: node --experimental-strip-types --test src/renderer/src/libs/customer-voucher-issue.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

const { decideIssueAnswer } = await import("./customer-voucher-issue.ts");

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
  assert.deepEqual(d, { action: "recovered", notice: "Earlier exchange recovered — voucher CV-ABC123" });
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

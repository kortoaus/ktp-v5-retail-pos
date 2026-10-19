// retail-delivery T-17 (D-24, D-14 review round 2) — the till's exchange
// service over the real operation storage: fake apiService.post (no axios, no
// network), in-memory localStorage shim. No modal mounting.
// Run: npm run test:orders
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

// Swap the axios-based apiService for a fake that the tests drive.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../libs/api" && context.parentURL?.endsWith("/service/customer-voucher.service.ts")) {
      return {
        url: "data:text/javascript,export default { post: (...a) => globalThis.__cvFakePost(...a), get: (...a) => globalThis.__cvFakeGet(...a) };",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const backing = new Map();
function storageOver(map) {
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}
globalThis.localStorage = storageOver(backing);

const calls = [];
let answers = [];
globalThis.__cvFakePost = async (endpoint, body) => {
  calls.push({ endpoint, body });
  return answers.shift();
};
globalThis.__cvFakeGet = async () => {
  throw new Error("not used");
};

const svc = await import("./customer-voucher.service.ts");
const ops = await import("../libs/operation-id.ts");

const MEMBER = "member-1";
const RECORD = `ktpv5.operationAttempt.cv-issue:${MEMBER}`;
const lost = { ok: false, status: 0, msg: "Network Error", result: null, paging: null };
const issued = (replayed = false) => ({
  ok: true,
  status: 200,
  msg: "ok",
  result: { voucher: { id: 9, serial: "CV-1" }, memberPoints: 500, replayed },
  paging: null,
});

beforeEach(() => {
  backing.clear();
  calls.length = 0;
  answers = [];
  ops.setOperationStorage(null); // default: the localStorage shim
});

test("(1) fresh $25 issue → body {memberId, amount 2500, operationId}; attempt stored with payload amount 2500", async () => {
  answers = [lost];
  await svc.issueCustomerVoucher(MEMBER, 2500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/api/customer-voucher/issue");
  const { operationId } = calls[0].body;
  assert.equal(typeof operationId, "string");
  assert.deepEqual(calls[0].body, { memberId: MEMBER, amount: 2500, operationId });
  const stored = JSON.parse(backing.get(RECORD));
  assert.equal(stored.operationId, operationId);
  assert.deepEqual(stored.payload, { amount: 2500 });
  assert.deepEqual(svc.pendingCustomerVoucherIssue(MEMBER), { amount: 2500 });
});

test("(2) lost answer → still pending; a $10 issue is refused without a call; resume resends id X and 2500", async () => {
  answers = [lost];
  await svc.issueCustomerVoucher(MEMBER, 2500);
  const X = calls[0].body.operationId;
  assert.deepEqual(svc.pendingCustomerVoucherIssue(MEMBER), { amount: 2500 });

  const refused = await svc.issueCustomerVoucher(MEMBER, 1000);
  assert.equal(refused.ok, false);
  assert.equal(refused.msg, "Previous exchange not confirmed — finish it first");
  assert.equal(calls.length, 1, "no network call for the refused issue");

  answers = [issued(true)];
  const res = await svc.resumeCustomerVoucherIssue(MEMBER);
  assert.equal(res.ok, true);
  assert.deepEqual(calls[1].body, { memberId: MEMBER, amount: 2500, operationId: X });
});

test("(3) restart (new storage instance over the same data) → resume still sends X and 2500", async () => {
  answers = [lost];
  await svc.issueCustomerVoucher(MEMBER, 2500);
  const X = calls[0].body.operationId;

  ops.setOperationStorage(storageOver(backing)); // a fresh store reading the persisted data
  assert.deepEqual(svc.pendingCustomerVoucherIssue(MEMBER), { amount: 2500 });
  answers = [issued(true)];
  await svc.resumeCustomerVoucherIssue(MEMBER);
  assert.deepEqual(calls[1].body, { memberId: MEMBER, amount: 2500, operationId: X });
});

test("(4) previous-release record (no payload) → resume sends no amount key and the same id", async () => {
  const legacyId = "3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f";
  backing.set(RECORD, JSON.stringify({ operationId: legacyId, createdAt: 1 }));
  assert.deepEqual(svc.pendingCustomerVoucherIssue(MEMBER), { amount: undefined });

  const refused = await svc.issueCustomerVoucher(MEMBER, 2500);
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 0);

  answers = [issued(true)];
  await svc.resumeCustomerVoucherIssue(MEMBER);
  assert.deepEqual(calls[0].body, { memberId: MEMBER, operationId: legacyId });
  assert.equal("amount" in calls[0].body, false);
});

test("(5) an ok answer settles the attempt; the next issue mints a new id", async () => {
  answers = [issued()];
  await svc.issueCustomerVoucher(MEMBER, 2500);
  const first = calls[0].body.operationId;
  assert.equal(svc.pendingCustomerVoucherIssue(MEMBER), null);
  assert.equal(backing.has(RECORD), false);

  const nothing = await svc.resumeCustomerVoucherIssue(MEMBER);
  assert.equal(nothing.ok, false);
  assert.equal(calls.length, 1, "resume without a pending exchange sends nothing");

  answers = [issued()];
  await svc.issueCustomerVoucher(MEMBER, 1000);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].body.operationId, first);
  assert.equal(calls[1].body.amount, 1000);
});

// npm run test:sale-core (retail-eftpos T-7) — the integrated CREDIT tender:
// long-poll state reducer, the session loop against a fake lane API (no
// server, no DB), amount replacement on APPROVED, receipt jobs.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALREADY_APPLIED,
  OVERRIDE_QUESTION,
  STORE_UNREACHABLE,
  activeLanePairing,
  approvedAmountOf,
  eftErrorText,
  pairingStateText,
  createEftSession,
  eftFlowReducer,
  eftPanelView,
  initialEftFlow,
  initialPrintMarks,
  nextMinVersion,
  outcomeOf,
  receiptJobs,
} from "./eft-flow.ts";
import { buildEftReceiptBytes } from "./eft-receipt.ts";

function txn(patch = {}) {
  return {
    id: "t1",
    version: 1,
    kind: "PURCHASE",
    operationId: "op-12345678",
    amountCents: 1000,
    surchargeCents: 0,
    status: "PENDING",
    message: "Present card",
    displayMessage: "Present card",
    financialStatus: null,
    resultAmounts: null,
    merchantReceipt: null,
    customerReceipt: null,
    cardDetails: null,
    actionForm: null,
    autoActions: [],
    merchantPrintSeq: 0,
    customerPrintSeq: 0,
    errorClass: null,
    errorCode: null,
    overrideAnswer: null,
    overrideRequired: false,
    final: false,
    cancelRequested: false,
    invoiceId: null,
    startedAt: null,
    finalisedAt: null,
    ...patch,
  };
}
const ok = (result, status = 200) => ({ ok: true, status, msg: "Success", result });
const fail = (status, msg) => ({ ok: false, status, msg, result: null });
const approved = (patch = {}) =>
  txn({
    version: 3,
    status: "FINALISED",
    financialStatus: "APPROVED",
    displayMessage: "Approved",
    final: true,
    resultAmounts: { purchase: 1000, surcharge: 0, tip: 0, cashout: 0, refund: 0, moto: 0 },
    merchantReceipt: "MERCHANT COPY",
    customerReceipt: "CUSTOMER COPY",
    ...patch,
  });

function started(requestCents = 1000) {
  return eftFlowReducer(initialEftFlow(), { type: "start", requestCents });
}

test("reducer: PENDING → AWAITING_POS → FINALISED APPROVED, min_version follows the version", () => {
  let s = started();
  assert.equal(s.phase, "starting");
  assert.equal(nextMinVersion(s), null);
  s = eftFlowReducer(s, { type: "create-answer", res: ok(txn(), 201) });
  assert.equal(s.phase, "live");
  assert.equal(nextMinVersion(s), 2);
  s = eftFlowReducer(s, { type: "poll-answer", res: ok(txn({ version: 2, message: "Processing", displayMessage: "Processing" })) });
  assert.equal(eftPanelView(s).message, "Processing");
  const form = { layout: [{ horizontal_layout: [{ key: "approve" }] }], properties: { approve: { type: "button", label: "Approve", submit: true } } };
  s = eftFlowReducer(s, { type: "poll-answer", res: ok(txn({ version: 3, status: "AWAITING_POS", actionForm: form })) });
  assert.equal(eftPanelView(s).actionForm, form);
  assert.equal(nextMinVersion(s), 4);
  s = eftFlowReducer(s, { type: "poll-answer", res: ok(approved({ version: 5 })) });
  assert.equal(s.phase, "done");
  assert.equal(nextMinVersion(s), null);
  assert.deepEqual(s.outcome, { kind: "paid", txnId: "t1", amountCents: 1000, viaOverride: false });
});

test("reducer: a hold expiry (same version) and an older answer change nothing", () => {
  let s = eftFlowReducer(started(), { type: "create-answer", res: ok(txn({ version: 4 })) });
  const same = eftFlowReducer(s, { type: "poll-answer", res: ok(txn({ version: 4 })) });
  assert.equal(nextMinVersion(same), 5);
  const older = eftFlowReducer(s, { type: "poll-answer", res: ok(txn({ version: 2, status: "FINALISED", final: true })) });
  assert.equal(older, s);
});

test("reducer: overrideRequired straight after a create shows the override question", () => {
  const s = eftFlowReducer(started(), {
    type: "create-answer",
    res: ok(
      txn({
        status: "TIMEOUT",
        errorClass: "NET",
        errorCode: "CREATE_UNKNOWN",
        overrideRequired: true,
        displayMessage: "Lost contact while starting the payment — check the terminal. Was it successful? [NET]",
      }),
    ),
  });
  assert.equal(s.phase, "live");
  const v = eftPanelView(s);
  assert.equal(v.showOverride, true);
  assert.match(v.message, /\[NET\]$/);
  assert.equal(OVERRIDE_QUESTION, "Was the transaction successful?");
  assert.equal(nextMinVersion(s), 2, "keeps polling while the override is open (a late answer can still land)");
});

test("reducer: override YES pays the keyed amount; NO is not paid", () => {
  const live = eftFlowReducer(started(), { type: "create-answer", res: ok(txn({ status: "TIMEOUT", overrideRequired: true })) });
  const yes = eftFlowReducer(eftFlowReducer(live, { type: "request-sent" }), {
    type: "request-answer",
    res: ok(txn({ version: 2, status: "FINALISED_BY_OVERRIDE", overrideAnswer: "YES", final: true, displayMessage: "Recorded as paid (manual confirmation)" })),
  });
  assert.deepEqual(yes.outcome, { kind: "paid", txnId: "t1", amountCents: 1000, viaOverride: true });
  const no = eftFlowReducer(live, {
    type: "request-answer",
    res: ok(txn({ version: 2, status: "CANCELLED_BY_OVERRIDE", overrideAnswer: "NO", final: true, displayMessage: "Recorded as not paid (manual confirmation)" })),
  });
  assert.equal(no.outcome.kind, "not-paid");
  assert.equal(no.outcome.message, "Recorded as not paid (manual confirmation)");
});

test("reducer: 502 on an action keeps the loop live with the server's message; STALE_VERSION too", () => {
  const live = eftFlowReducer(started(), { type: "create-answer", res: ok(txn({ status: "AWAITING_POS", version: 3 })) });
  const sent = eftFlowReducer(live, { type: "request-sent" });
  assert.equal(eftPanelView(sent).busy, true);
  const lost = eftFlowReducer(sent, { type: "request-answer", res: fail(502, "The action may not have reached the payment service — checking the terminal [NET]") });
  assert.equal(lost.phase, "live");
  assert.equal(lost.busy, false);
  assert.equal(nextMinVersion(lost), 4);
  assert.match(lost.notice, /\[NET\]$/);
  const stale = eftFlowReducer(sent, { type: "request-answer", res: fail(409, "The payment changed — showing the latest state [POS]") });
  assert.equal(stale.phase, "live");
  assert.match(stale.notice, /\[POS\]$/);
  // the next newer version clears the notice
  const moved = eftFlowReducer(stale, { type: "poll-answer", res: ok(txn({ version: 4, status: "PENDING" })) });
  assert.equal(moved.notice, null);
});

test("reducer: the till cannot reach the store server → Store server unreachable [NET]", () => {
  const create = eftFlowReducer(started(), { type: "create-answer", res: fail(0, "Network Error") });
  assert.deepEqual(create.outcome, { kind: "not-paid", txnId: null, message: STORE_UNREACHABLE });
  const live = eftFlowReducer(started(), { type: "create-answer", res: ok(txn()) });
  const poll = eftFlowReducer(live, { type: "poll-answer", res: fail(0, "Network Error") });
  assert.equal(poll.phase, "live");
  assert.equal(poll.notice, STORE_UNREACHABLE);
  const gone = eftFlowReducer(live, { type: "poll-answer", res: fail(404, "EFT transaction not found") });
  assert.equal(gone.phase, "done");
  assert.equal(gone.outcome.message, "EFT transaction not found [POS]");
});

test("reducer: declined / failed / 409 are not paid with the server text; 503 not configured → keyed", () => {
  const declined = eftFlowReducer(started(), {
    type: "create-answer",
    res: ok(txn({ status: "FINALISED", financialStatus: "DECLINED", final: true, displayMessage: "Insufficient funds [BANK]" })),
  });
  assert.deepEqual(declined.outcome, { kind: "not-paid", txnId: "t1", message: "Insufficient funds [BANK]" });
  const mismatch = eftFlowReducer(started(), { type: "create-answer", res: fail(409, "This sale already has a card payment for a different amount [POS]") });
  assert.equal(mismatch.outcome.message, "This sale already has a card payment for a different amount [POS]");
  assert.equal(mismatch.unavailable, false);
  const off = eftFlowReducer(started(), { type: "create-answer", res: fail(503, "EFT is not configured") });
  assert.equal(off.unavailable, true);
  assert.equal(off.outcome.message, "EFT is not configured [PAIR]");
  assert.equal(eftErrorText({ ok: false, status: 400, msg: "amountCents must be a positive integer (cents)", result: null }), "amountCents must be a positive integer (cents) [POS]");
  assert.equal(eftErrorText({ ok: false, status: 409, msg: "No payment terminal selected", result: { errorClass: "PAIR", errorCode: "NO_PAIRING_SELECTED" } }), "No payment terminal selected [PAIR]");
});

test("reducer: the same approved row is never applied twice to one payment list", () => {
  const s = eftFlowReducer(started(), { type: "create-answer", res: ok(approved()), appliedTxnIds: ["t1"] });
  assert.deepEqual(s.outcome, { kind: "not-paid", txnId: "t1", message: ALREADY_APPLIED });
  const resumed = eftFlowReducer(started(), { type: "create-answer", res: ok(approved()), appliedTxnIds: ["other"] });
  assert.equal(resumed.outcome.kind, "paid", "a restart / reopened panel resumes the same approved row once");
});

test("amount replacement on APPROVED: resultAmounts purchase + surcharge + tip, never the keyed amount", () => {
  assert.equal(approvedAmountOf({ amountCents: 1000, resultAmounts: { purchase: 950, surcharge: 0, tip: 0 } }), 950);
  assert.equal(approvedAmountOf({ amountCents: 1000, resultAmounts: { purchase: 1000, surcharge: 15, tip: 200, cashout: 5000 } }), 1215);
  assert.equal(outcomeOf(approved({ resultAmounts: { purchase: 990, surcharge: 10, tip: 0 } })).amountCents, 1000);
  assert.equal(outcomeOf(approved({ amountCents: 1234, resultAmounts: { purchase: 1200 } })).amountCents, 1200);
  // no result block at all: what the terminal was asked
  assert.equal(approvedAmountOf({ amountCents: 777, resultAmounts: null }), 777);
  assert.equal(outcomeOf(txn({ status: "FINALISED", financialStatus: "UNKNOWN", overrideRequired: true })), null);
});

test("receipt jobs: final prints both once; print seqs and the auto action print the merchant copy", () => {
  let marks = initialPrintMarks();
  const sig = txn({ version: 3, status: "AWAITING_POS", autoActions: ["PRINT_MERCHANT_RECEIPT"], merchantReceipt: "SIGNATURE SLIP" });
  let r = receiptJobs(marks, sig);
  assert.deepEqual(r.jobs, [{ which: "merchant", text: "SIGNATURE SLIP" }]);
  marks = r.marks;
  assert.deepEqual(receiptJobs(marks, sig).jobs, [], "same version → no second auto print");
  r = receiptJobs(marks, txn({ version: 4, status: "AWAITING_POS", merchantReceipt: "SIGNATURE SLIP", customerPrintSeq: 1, customerReceipt: "CUST" }));
  assert.deepEqual(r.jobs, [{ which: "customer", text: "CUST" }]);
  marks = r.marks;
  r = receiptJobs(marks, approved({ version: 6 }));
  assert.deepEqual(r.jobs.map((j) => j.which), ["merchant", "customer"]);
  assert.deepEqual(receiptJobs(r.marks, approved({ version: 6 })).jobs, []);
  const declined = txn({ status: "FINALISED", financialStatus: "DECLINED", final: true, merchantReceipt: "M", customerReceipt: "C" });
  assert.equal(receiptJobs(initialPrintMarks(), declined).jobs.length, 2, "declined receipts print too");
});

test("receipt bytes: init, ASCII text, cut", () => {
  const b = buildEftReceiptBytes("A\r\nB é\n\n");
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);
  assert.equal(String.fromCharCode(...b.slice(2, 8)), "A\nB ?\n");
  assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 3]);
});

test("activeLanePairing: only the lane's selected, active pairing", () => {
  const p = (id, selectedForThisTerminal, active) => ({ id, selectedForThisTerminal, active });
  assert.equal(activeLanePairing([p(1, false, true), p(2, true, true)]).id, 2);
  assert.equal(activeLanePairing([p(1, true, false), p(2, false, true)]), null, "never auto-picked");
  assert.equal(activeLanePairing(null), null);
});

// ── the session loop against a fake lane API ──────────────────────────────

function fakeApi(script) {
  const calls = [];
  const api = {
    create: async (body) => (calls.push(["create", body]), script.create(body)),
    get: async (id, minVersion) => (calls.push(["get", id, minVersion]), script.get(minVersion)),
    action: async (id, body) => (calls.push(["action", id, body]), script.action(body)),
    override: async (id, answer) => (calls.push(["override", id, answer]), script.override(answer)),
    cancel: async (id) => (calls.push(["cancel", id]), script.cancel()),
  };
  return { api, calls };
}

test("session: create with surcharge 0, long-poll min_version = last + 1, stop at final, receipts printed", async () => {
  const answers = [ok(txn({ version: 1 })), ok(txn({ version: 2, message: "Processing" })), ok(approved({ version: 3 }))];
  const { api, calls } = fakeApi({ create: () => ok(txn(), 201), get: () => answers.shift() });
  const printed = [];
  const states = [];
  const s = createEftSession({ api, onState: (st) => states.push(st.phase), print: async (j) => void printed.push(j.which), sleep: async () => {} });
  await s.start({ operationId: "op-12345678", amountCents: 1000 });
  await s.printsSettled();
  assert.deepEqual(calls[0], ["create", { operationId: "op-12345678", kind: "PURCHASE", amountCents: 1000, surchargeCents: 0 }]);
  assert.deepEqual(calls.slice(1).map((c) => c[2]), [2, 2, 3]);
  assert.equal(s.getState().outcome.kind, "paid");
  assert.equal(states.at(-1), "done");
  assert.deepEqual(printed, ["merchant", "customer"]);
});

test("session: a poll error keeps polling with the same min_version after a pause", async () => {
  const answers = [fail(0, "Network Error"), ok(approved({ version: 2 }))];
  const { api, calls } = fakeApi({ create: () => ok(txn(), 201), get: () => answers.shift() });
  let slept = 0;
  const s = createEftSession({ api, onState: () => {}, sleep: async () => void slept++ });
  await s.start({ operationId: "op-12345678", amountCents: 1000 });
  assert.deepEqual(calls.slice(1).map((c) => c[2]), [2, 2]);
  assert.equal(slept, 1);
  assert.equal(s.getState().outcome.kind, "paid");
});

test("session: 502 / STALE_VERSION on an action → immediate re-read, then the loop carries on", async () => {
  const form = { properties: { approve: { type: "button", label: "Approve", submit: true } } };
  let release;
  const held = new Promise((r) => (release = r));
  const polls = [held];
  const { api, calls } = fakeApi({
    create: () => ok(txn({ status: "AWAITING_POS", version: 3, actionForm: form }), 201),
    get: (minVersion) => (minVersion == null ? ok(txn({ status: "PENDING", version: 4, message: "Checking the terminal…" })) : polls.shift() ?? ok(approved({ version: 5 }))),
    action: () => fail(502, "The action may not have reached the payment service — checking the terminal [NET]"),
  });
  const s = createEftSession({ api, onState: () => {}, sleep: async () => {} });
  const run = s.start({ operationId: "op-12345678", amountCents: 1077 });
  await new Promise((r) => setImmediate(r));
  await s.pressButton({ buttonKey: "approve", inputs: {}, version: 3 });
  assert.deepEqual(calls.find((c) => c[0] === "action")[2], { buttonKey: "approve", inputs: {}, version: 3 });
  assert.ok(calls.some((c) => c[0] === "get" && c[2] === null), "re-read without min_version");
  assert.equal(s.getState().txn.version, 4);
  assert.equal(s.getState().phase, "live");
  release(ok(txn({ status: "PENDING", version: 4 })));
  await run;
  assert.equal(s.getState().outcome.kind, "paid");
});

test("session: stop() leaves the payment without further requests", async () => {
  let release;
  const { api, calls } = fakeApi({ create: () => ok(txn(), 201), get: () => new Promise((r) => (release = r)) });
  const s = createEftSession({ api, onState: () => {}, sleep: async () => {} });
  const run = s.start({ operationId: "op-12345678", amountCents: 1000 });
  await new Promise((r) => setImmediate(r));
  s.stop();
  release(ok(approved({ version: 2 })));
  await run;
  assert.equal(calls.filter((c) => c[0] === "get").length, 1);
  assert.equal(s.getState().phase, "live", "a late answer after stop is not applied");
});

// ── the approved amount in the tender queue ───────────────────────────────
import { addApprovedCredit, appliedTxnIds } from "./eft-tender.ts";
import { createTenderState, selectTender, tenderReducer } from "../sale/tender-queue.ts";
import { buildNewLine } from "../../store/SalesStore.helper.ts";

function saleLine(cents) {
  return buildNewLine(
    {
      type: "normal",
      itemId: 1,
      name_en: "Item",
      name_ko: "",
      price: { prices: [cents] },
      promoPrice: null,
      taxable: true,
      isPointExcluded: false,
      uom: "ea",
      barcode: "1",
    },
    0,
    0,
  );
}

test("APPROVED replaces the keyed draft: the payment is the approved amount, remaining 0", () => {
  const rates = { creditSurchargeRate: 0, cashPointRate: 10, otherPointRate: 10 };
  const lines = [saleLine(1000)];
  let s = createTenderState();
  s = tenderReducer(s, { type: "change-slot", slot: "CREDIT" });
  s = tenderReducer(s, { type: "set-credit-bill", billPortion: 1000, left: 1000, surchargeRate: 0 });
  assert.equal(s.staged.amount, 1000, "keyed request");
  const outcome = outcomeOf(approved({ resultAmounts: { purchase: 1000, surcharge: 0, tip: 0 } }));
  s = addApprovedCredit(s, { type: "eft-approved", key: "k1", amountCents: outcome.amountCents });
  assert.deepEqual(s.payments, [{ key: "k1", tender: "CREDIT", amount: 1000 }]);
  assert.equal(s.staged.tender, "CREDIT");
  assert.equal(s.staged.amount, 0, "the draft is not counted twice");
  const view = selectTender(s, { lines, rates, hasMember: false });
  assert.equal(view.cal.linesTotal, 1000);
  assert.equal(view.cal.remaining, 0);
  assert.equal(view.completeDisabled, false);
  assert.equal(addApprovedCredit(s, { type: "eft-approved", key: "k1", amountCents: 1000 }), s, "same key twice is a no-op");
  assert.equal(addApprovedCredit(s, { type: "eft-approved", key: "k2", amountCents: 0 }), s);
  assert.deepEqual(appliedTxnIds(s.payments, new Map([["k1", "t1"], ["gone", "t9"]])), ["t1"]);
});

test("pairing screen texts: server text verbatim, externally unpaired is visible", () => {
  assert.equal(eftErrorText({ ok: false, status: 400, msg: "Pairing was not accepted — check the code on the terminal [PAIR]", result: null }), "Pairing was not accepted — check the code on the terminal [PAIR]");
  assert.equal(eftErrorText({ ok: false, status: 0, msg: "Network Error", result: null }), STORE_UNREACHABLE);
  assert.deepEqual(pairingStateText({ active: true, lastError: null, lastTestOk: true }), { tone: "ok", text: "Paired" });
  assert.equal(pairingStateText({ active: false, lastError: "no_active_pairings_found", lastTestOk: false }).tone, "warn");
  assert.match(pairingStateText({ active: false, lastError: "no_active_pairings_found", lastTestOk: false }).text, /\[PAIR\]$/);
  assert.equal(pairingStateText({ active: false, lastError: "unpaired", lastTestOk: null }).text, "Unpaired");
});

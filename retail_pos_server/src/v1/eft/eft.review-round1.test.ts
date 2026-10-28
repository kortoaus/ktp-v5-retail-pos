import assert from "node:assert/strict";
import test from "node:test";
import type { EftConfig } from "./eft.config";
import { encryptSecret } from "./eft.crypto";
import { EftEngine } from "./eft.engine";
import { excerpt, classifySciError } from "./sci/sci.provider";
import { MemoryEftStore } from "./eft.test-fakes";
import type { EftProvider, PollOutcome, ProviderResult, ProviderTxnAnswer } from "./provider";

// Codex D-14 review round 1 on T-6: F-2 (transitions validated under the lock,
// overridden rows frozen), F-4 (excerpt), F-6 (bookkeeping drained without a loop).

const KEY = "e".repeat(64);
const http = { method: "POST", path: "/x", status: 200, durationMs: 1 };
const ok = <T>(value: T): ProviderResult<T> => ({ ok: true, value, http });

function answer(v: number, status: ProviderTxnAnswer["status"], extra: Partial<ProviderTxnAnswer> = {}): ProviderTxnAnswer {
  return {
    providerTxnId: "txn_r1", providerVersion: v, status, message: status, financialStatus: null, resultAmounts: null,
    merchantReceipt: null, customerReceipt: null, cardDetails: null, posInstructions: null, ...extra,
  };
}

const signatureForm = {
  auto_actions: [],
  action_form: {
    properties: {
      approve: { type: "button", label: "Approve", submit_url: "https://sci.test/v1/transactions/txn_r1?action=APPROVE_SIGNATURE" },
      print: { type: "button", label: "Print", action: "PRINT_MERCHANT_RECEIPT" },
    },
  },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(polls: Array<ProviderTxnAnswer | "not_yet">, submit: () => Promise<ProviderResult<ProviderTxnAnswer | null>>, cfg: Partial<EftConfig> = {}) {
  const queue = [...polls];
  const provider: EftProvider = {
    id: "sci",
    pair: async () => ok({ pairingId: "p", keyId: "k", signingSecretPartB: "b", baseUrl: "https://sci.test", confirmationCode: "1", tid: null, pairingNickname: null, terminalNickname: null }),
    pairingInfo: async () => ok({}),
    unpair: async () => ok(null),
    createTransaction: async () => ok(answer(1, "PENDING")),
    pollTransaction: async (): Promise<ProviderResult<PollOutcome>> => {
      await new Promise((r) => setTimeout(r, 5));
      const s = queue.shift() ?? "not_yet";
      return ok(s === "not_yet" ? { kind: "not_yet" } : { kind: "answer", answer: s });
    },
    submitAction: submit,
    cancel: async () => ({ supported: false }),
  };
  const store = new MemoryEftStore();
  store.pairings.push({
    id: 1, provider: "sci", pairingId: "p", keyId: "k", signingSecretPartBEnc: encryptSecret("partB", KEY), baseUrl: "https://sci.test",
    tid: null, pairingNickname: null, terminalNickname: null, active: true, lastTestAt: null, lastTestOk: null, lastError: null,
    lastSciOkAt: null, lastSciErrorAt: null, lastSciErrorCode: null, createdAt: new Date(), updatedAt: new Date(),
  });
  store.terminals[0].eftPairingId = 1;
  const config: EftConfig = {
    pairingApiUrl: "https://pair.test", pairingApiKey: "k", signingSecretPartA: "a", secretKeyHex: KEY,
    pollDeadlineMs: 150, laneHoldMs: 200, eventRetentionDays: 180, lateWatchMs: 150, retryBackoffMs: 5, ...cfg,
  };
  const engine = new EftEngine({ store, config, providerFor: () => provider, log: () => undefined });
  return { store, engine };
}

const lane = { terminalId: 1, eftPairingId: 1, userId: 3 };
type HttpErr = Error & { statusCode?: number; result?: { errorCode?: string } };

test("F-2: an override YES made while an action relay is in flight is never overwritten by the action's answer", async () => {
  const relay = deferred<ProviderResult<ProviderTxnAnswer | null>>();
  const { engine, store } = setup([answer(2, "AWAITING_POS", { posInstructions: signatureForm })], () => relay.promise);
  const { txn } = await engine.createTransaction(lane, { operationId: "op-r1-race-01", kind: "PURCHASE", amountCents: 500 });
  await engine.idle();
  assert.equal((await engine.getTransaction(txn.id, null)).status, "AWAITING_POS");

  const pressed = engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 3);
  // A second press while the first is in flight is refused.
  await assert.rejects(engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 3), (e: HttpErr) => e.statusCode === 409 && e.result?.errorCode === "ACTION_IN_FLIGHT");

  // Any concurrent path that moved the row on (simulated directly), then the cashier answers YES.
  store.txns.get(txn.id)!.status = "TIMEOUT";
  await engine.override(txn.id, { answer: "YES" }, 3);
  const frozen = { ...store.txns.get(txn.id)! };

  relay.resolve(ok(answer(3, "FINALISED", { financialStatus: "DECLINED" })));
  await pressed;
  await engine.idle();
  const after = store.txns.get(txn.id)!;
  assert.equal(after.status, "FINALISED_BY_OVERRIDE");
  assert.equal(after.financialStatus, null);
  assert.equal(after.version, frozen.version);
  assert.equal(after.providerVersion, frozen.providerVersion);
  assert.ok((await engine.listEvents(txn.id)).some((e) => e.event === "LATE_RESULT"));
  // Local actions on an overridden row are refused too.
  await assert.rejects(engine.submitAction(txn.id, { buttonKey: "print", inputs: {} }, 3), (e: HttpErr) => e.statusCode === 409);
  await engine.stop();
});

test("F-2: a stale version on an action is refused; overridden rows ignore late poll answers entirely", async () => {
  const polls: Array<ProviderTxnAnswer | "not_yet"> = [];
  for (let i = 0; i < 40; i++) polls.push("not_yet");
  polls.push(answer(5, "PENDING", { message: "late progress" }), answer(6, "FINALISED", { financialStatus: "APPROVED" }));
  const { engine, store } = setup(polls, async () => ok(null), { lateWatchMs: 3000 });
  const { txn } = await engine.createTransaction(lane, { operationId: "op-r1-late-01", kind: "PURCHASE", amountCents: 500 });
  let v = await engine.getTransaction(txn.id, null);
  while (v.status !== "TIMEOUT") v = await engine.getTransaction(txn.id, v.version + 1, undefined, 300);
  await engine.override(txn.id, { answer: "NO" }, 3);
  const frozen = { ...store.txns.get(txn.id)! };
  await engine.idle();
  const after = store.txns.get(txn.id)!;
  assert.equal(after.status, "CANCELLED_BY_OVERRIDE");
  assert.equal(after.message, frozen.message);
  assert.equal(after.version, frozen.version);
  assert.equal(after.providerVersion, frozen.providerVersion);
  const late = (await engine.listEvents(txn.id)).filter((e) => e.event === "LATE_RESULT");
  assert.equal(late.length, 1);
  await engine.stop();
});

test("F-6: no loop-less path leaves bookkeeping behind (signature completion, UNKNOWN override)", async () => {
  const s1 = setup([answer(2, "AWAITING_POS", { posInstructions: signatureForm })], async () => ok(answer(3, "FINALISED", { financialStatus: "APPROVED" })));
  const a = await s1.engine.createTransaction(lane, { operationId: "op-r1-mem-001", kind: "PURCHASE", amountCents: 500 });
  await s1.engine.idle();
  const done = await s1.engine.submitAction(a.txn.id, { buttonKey: "approve", inputs: {} }, 3);
  assert.equal(done.financialStatus, "APPROVED");
  await s1.engine.idle();
  assert.deepEqual(s1.engine.memoryStats(), { loops: 0, eventQueues: 0, seqs: 0, locks: 0, actionsInFlight: 0, waiters: 0 });

  const s2 = setup([answer(2, "FINALISED", { financialStatus: "UNKNOWN" })], async () => ok(null));
  const b = await s2.engine.createTransaction(lane, { operationId: "op-r1-mem-002", kind: "PURCHASE", amountCents: 500 });
  await s2.engine.idle();
  await s2.engine.override(b.txn.id, { answer: "YES" }, 3);
  await s2.engine.idle();
  assert.deepEqual(s2.engine.memoryStats(), { loops: 0, eventQueues: 0, seqs: 0, locks: 0, actionsInFlight: 0, waiters: 0 });
  // Event seqs stay contiguous across cache drops (re-read from the store).
  const seqs = (await s2.engine.listEvents(b.txn.id)).map((e) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  await s1.engine.stop();
  await s2.engine.stop();
});

test("F-4: excerpt redacts structured bodies before serialising and drops unstructured ones", () => {
  const secret = "s3cr3t-part-b-value";
  const sig = "sig1=:QUJDREVGR0g=:";
  const out = JSON.stringify(excerpt({ error: { code: "x", message: `echo ${secret} ${sig}`, Signature: sig } }, [secret]));
  assert.equal(out.includes(secret), false);
  assert.equal(out.includes("QUJDREVGR0g="), false);
  assert.equal(excerpt(`plain text with ${secret}`, [secret]), undefined);
  const err = classifySciError(502, `<html>${secret}</html>`, undefined, [secret]);
  assert.equal(err.detail, undefined);
  assert.equal(err.errorCode, "HTTP_502");
  assert.equal(err.ambiguous, true);
  assert.equal(classifySciError(null, null, "TimeoutError: aborted").ambiguous, true);
  assert.equal(classifySciError(424, { error: { code: "device_not_connected" } }).ambiguous, undefined);
});

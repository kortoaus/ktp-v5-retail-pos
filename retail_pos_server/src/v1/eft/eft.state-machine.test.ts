import assert from "node:assert/strict";
import test from "node:test";
import type { EftConfig } from "./eft.config";
import { EftEngine } from "./eft.engine";
import { encryptSecret } from "./eft.crypto";
import { sanitizeDetail } from "./eft.events";
import { MemoryEftStore } from "./eft.test-fakes";
import type { EftProvider, PollOutcome, ProviderResult, ProviderTxnAnswer } from "./provider";

// State machine with a scripted provider (no HTTP): each poll returns the next
// scripted answer, "not_yet", or an error.

const KEY = "b".repeat(64);
const http = { method: "GET", path: "/v1/transactions/x", status: 200, durationMs: 1 };

function answer(v: number, status: ProviderTxnAnswer["status"], extra: Partial<ProviderTxnAnswer> = {}): ProviderTxnAnswer {
  return {
    providerTxnId: "txn_s",
    providerVersion: v,
    status,
    message: status,
    financialStatus: null,
    resultAmounts: null,
    merchantReceipt: null,
    customerReceipt: null,
    cardDetails: null,
    posInstructions: null,
    ...extra,
  };
}

type Step = ProviderTxnAnswer | "not_yet" | "error";

function scripted(steps: Step[]): EftProvider {
  const queue = [...steps];
  const ok = <T>(value: T): ProviderResult<T> => ({ ok: true, value, http });
  return {
    id: "sci",
    pair: async () => ok({ pairingId: "p", keyId: "k", signingSecretPartB: "b", baseUrl: "https://sci.test", confirmationCode: "111", tid: null, pairingNickname: null, terminalNickname: null }),
    pairingInfo: async () => ok({}),
    unpair: async () => ok(null),
    createTransaction: async () => ok(answer(1, "PENDING")),
    pollTransaction: async (): Promise<ProviderResult<PollOutcome>> => {
      await new Promise((r) => setTimeout(r, 5));
      const s = queue.shift() ?? "not_yet";
      if (s === "not_yet") return ok({ kind: "not_yet" });
      if (s === "error") return { ok: false, error: { errorClass: "NET", errorCode: "FETCH_FAILED", message: "down", retryable: true }, http: null };
      return ok({ kind: "answer", answer: s });
    },
    submitAction: async () => ok(null),
    cancel: async () => ({ supported: false }),
  };
}

function setup(steps: Step[], cfg: Partial<EftConfig> = {}) {
  const store = new MemoryEftStore();
  store.pairings.push({
    id: 1, provider: "sci", pairingId: "p", keyId: "k", signingSecretPartBEnc: encryptSecret("partB", KEY), baseUrl: "https://sci.test",
    tid: null, pairingNickname: null, terminalNickname: null, active: true, lastTestAt: null, lastTestOk: null, lastError: null,
    lastSciOkAt: null, lastSciErrorAt: null, lastSciErrorCode: null, createdAt: new Date(), updatedAt: new Date(),
  });
  store.terminals[0].eftPairingId = 1;
  const config: EftConfig = {
    pairingApiUrl: "https://pair.test", pairingApiKey: "k", signingSecretPartA: "a", secretKeyHex: KEY,
    pollDeadlineMs: 150, laneHoldMs: 200, eventRetentionDays: 180, lateWatchMs: 200, retryBackoffMs: 5, ...cfg,
  };
  const engine = new EftEngine({ store, config, providerFor: () => scripted(steps), log: () => undefined });
  return { store, engine };
}

const lane = { terminalId: 1, eftPairingId: 1, userId: 9 };

test("FINALISED with UNKNOWN → override required; NO → CANCELLED_BY_OVERRIDE (retryable)", async () => {
  const { engine, store } = setup([answer(2, "FINALISED", { financialStatus: "UNKNOWN" })]);
  const { txn } = await engine.createTransaction(lane, { operationId: "op-unknown-1", kind: "PURCHASE", amountCents: 500 });
  await engine.idle();
  const v = await engine.getTransaction(txn.id, null);
  assert.equal(v.status, "FINALISED");
  assert.equal(v.financialStatus, "UNKNOWN");
  assert.equal(v.overrideRequired, true);
  assert.equal(v.final, false);
  const no = await engine.override(txn.id, { answer: "NO" }, 9);
  assert.equal(no.status, "CANCELLED_BY_OVERRIDE");
  assert.equal(store.txns.get(txn.id)!.overrideBy, 9);
  const retry = await engine.createTransaction(lane, { operationId: "op-unknown-1", kind: "PURCHASE", amountCents: 500 });
  assert.equal(retry.created, true);
  await engine.stop();
});

test("TIMEOUT, then a late FINALISED before any override → applied (bank answer wins)", async () => {
  const { engine } = setup(["not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "not_yet", answer(3, "FINALISED", { financialStatus: "APPROVED" })], { lateWatchMs: 2000 });
  const { txn } = await engine.createTransaction(lane, { operationId: "op-late-ok-1", kind: "PURCHASE", amountCents: 500 });
  let v = await engine.getTransaction(txn.id, null);
  const seen = new Set<string>();
  const end = Date.now() + 4000;
  while (!v.final && Date.now() < end) {
    seen.add(v.status);
    v = await engine.getTransaction(txn.id, v.version + 1, undefined, 300);
  }
  assert.ok(seen.has("TIMEOUT"));
  assert.equal(v.status, "FINALISED");
  assert.equal(v.financialStatus, "APPROVED");
  assert.equal(v.errorClass, null);
  await engine.idle();
  await engine.stop();
});

test("override YES is final: a later FINALISED DECLINED is only a LATE_RESULT event", async () => {
  const steps: Step[] = [];
  for (let i = 0; i < 40; i++) steps.push("not_yet");
  steps.push(answer(4, "FINALISED", { financialStatus: "DECLINED" }));
  const { engine } = setup(steps, { lateWatchMs: 3000 });
  const { txn } = await engine.createTransaction(lane, { operationId: "op-late-no-1", kind: "PURCHASE", amountCents: 500 });
  let v = await engine.getTransaction(txn.id, null);
  while (v.status !== "TIMEOUT") v = await engine.getTransaction(txn.id, v.version + 1, undefined, 300);
  const yes = await engine.override(txn.id, { answer: "YES" }, 9);
  assert.equal(yes.status, "FINALISED_BY_OVERRIDE");
  await engine.idle();
  const after = await engine.getTransaction(txn.id, null);
  assert.equal(after.status, "FINALISED_BY_OVERRIDE");
  assert.equal(after.financialStatus, null);
  const late = (await engine.listEvents(txn.id)).find((e) => e.event === "LATE_RESULT");
  assert.ok(late);
  assert.deepEqual((late.detail as Record<string, unknown>).financialStatus, "DECLINED");
  await engine.stop();
});

test("poll errors are retried (ERROR NET events) and never fail an upstream-created transaction", async () => {
  const { engine } = setup(["error", "error", answer(2, "FINALISED", { financialStatus: "APPROVED" })]);
  const { txn } = await engine.createTransaction(lane, { operationId: "op-neterr-1", kind: "PURCHASE", amountCents: 500 });
  await engine.idle();
  const v = await engine.getTransaction(txn.id, null);
  assert.equal(v.financialStatus, "APPROVED");
  const errors = (await engine.listEvents(txn.id)).filter((e) => e.event === "ERROR");
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.errorClass === "NET"));
  await engine.stop();
});

test("sanitizeDetail drops secret/signature keys, masks PAN runs, bounds size", () => {
  const out = sanitizeDetail({
    Signature: "sig1=:abc:",
    "signature-input": "x",
    signing_secret_part_b: "s",
    key_id: "k",
    keyId: "k",
    nested: { authorization: "ApiKey x", pan_last_4: "4242", pan_first_6: "412345", note: "card 4111 1111 1111 1111 ok" },
  }) as Record<string, unknown>;
  assert.deepEqual(out, { nested: { pan_last_4: "4242", pan_first_6: "412345", note: "card ****1111 ok" } });
  const big = sanitizeDetail({ body: "x".repeat(10_000) }) as Record<string, unknown>;
  assert.equal(big.truncated, true);
  assert.ok(JSON.stringify(big).length <= 4096 + 64);
});

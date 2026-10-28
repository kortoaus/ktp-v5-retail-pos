import assert from "node:assert/strict";
import test from "node:test";
import { startFakeSci, type FakeSciMode } from "../../dev/fake-sci";
import type { EftConfig } from "./eft.config";
import { decryptSecret } from "./eft.crypto";
import { EftEngine, type LaneTxnView } from "./eft.engine";
import { MemoryEftStore } from "./eft.test-fakes";
import { SciProvider, type FetchLike } from "./sci/sci.provider";

// retail-eftpos T-6 — the engine end to end against the fake SCI (ephemeral
// port, signatures verified), with the in-memory store. No DB.

const PART_A = "test-part-a-0123456789";
const API_KEY = "test-pairing-key";
const SECRET_KEY = "a".repeat(64);

async function harness(opts: { enginePartA?: string; mode?: Partial<FakeSciMode>; config?: Partial<EftConfig> } = {}) {
  const fakeLog: string[] = [];
  const fake = await startFakeSci({ port: 0, partA: PART_A, pairingApiKey: API_KEY, stepMs: 30, holdMs: 150, mode: opts.mode, log: (l) => fakeLog.push(l) });
  const sentHeaders: Record<string, string>[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    sentHeaders.push({ ...(init.headers as Record<string, string>) });
    return fetch(url, init);
  };
  const config: EftConfig = {
    pairingApiUrl: fake.url,
    pairingApiKey: API_KEY,
    signingSecretPartA: PART_A,
    secretKeyHex: SECRET_KEY,
    pollDeadlineMs: 400,
    laneHoldMs: 300,
    eventRetentionDays: 180,
    lateWatchMs: 300,
    retryBackoffMs: 20,
    ...opts.config,
  };
  const store = new MemoryEftStore();
  const provider = new SciProvider({ pairingApiUrl: fake.url, pairingApiKey: API_KEY, signingSecretPartA: opts.enginePartA ?? PART_A, fetchImpl });
  const lines: string[] = [];
  const engine = new EftEngine({ store, config, providerFor: () => provider, log: (l) => lines.push(l) });
  const lane = () => ({ terminalId: 1, eftPairingId: store.terminals[0].eftPairingId, userId: 7 });
  const pairLane = async () => {
    const p = await engine.pair({ pairingCode: "123456", nickname: "Lane 1" }, null);
    await engine.selectPairing(1, p.id);
    return p;
  };
  const until = async (id: string, pred: (v: LaneTxnView) => boolean, ms = 5000) => {
    let v = await engine.getTransaction(id, null);
    const end = Date.now() + ms;
    while (!pred(v)) {
      if (Date.now() > end) throw new Error(`timed out; last status ${v.status}`);
      v = await engine.getTransaction(id, v.version + 1, undefined, 500);
    }
    return v;
  };
  const close = async () => {
    await engine.stop();
    await fake.stop();
  };
  return { fake, fakeLog, store, engine, lines, sentHeaders, lane, pairLane, until, close, config };
}

let opSeq = 0;
const op = () => `op-test-${Date.now()}-${++opSeq}`;

test("pairing: confirmation code, part B encrypted at rest, test + list without secrets", async () => {
  const h = await harness();
  try {
    const p = await h.pairLane();
    assert.equal(p.confirmationCode, "456456");
    const row = h.store.pairings[0];
    assert.notEqual(row.signingSecretPartBEnc.length, 0);
    assert.ok(row.signingSecretPartBEnc.startsWith("v1."));
    const partB = decryptSecret(row.signingSecretPartBEnc, SECRET_KEY);
    assert.ok(!row.signingSecretPartBEnc.includes(partB));
    const t = await h.engine.testPairing(p.id);
    assert.equal(t.ok, true);
    const list = await h.engine.listPairings(p.id);
    assert.equal(list[0].selectedForThisTerminal, true);
    const json = JSON.stringify(list);
    for (const forbidden of [row.keyId, partB, row.baseUrl, "signingSecret"]) assert.ok(!json.includes(forbidden), forbidden);
  } finally {
    await h.close();
  }
});

test("$1.00 purchase: PENDING → FINALISED APPROVED with receipts, full event trail, loop gone", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    const { created, txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
    assert.equal(created, true);
    assert.equal(txn.status, "CREATING");
    const done = await h.until(txn.id, (v) => v.final);
    assert.equal(done.status, "FINALISED");
    assert.equal(done.financialStatus, "APPROVED");
    assert.match(done.merchantReceipt ?? "", /MERCHANT COPY/);
    assert.match(done.customerReceipt ?? "", /CUSTOMER COPY/);
    assert.deepEqual(done.cardDetails, { entry_mode: "CONTACTLESS", pan_first_6: "412345", pan_last_4: "4242", scheme_name: "VISA" });
    assert.equal(done.errorClass, null);
    await h.engine.idle();
    assert.equal(h.engine.activeLoopCount(), 0);
    const names = (await h.engine.listEvents(txn.id)).map((e) => e.event);
    for (const e of ["TILL_CREATE", "SCI_CREATE_REQ", "SCI_CREATE_RES", "SCI_POLL_REQ", "SCI_POLL_RES", "STATE"]) assert.ok(names.includes(e), e);
    const seqs = (await h.engine.listEvents(txn.id)).map((e) => e.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
    assert.ok(h.lines.some((l) => l.startsWith(`[eft] txn=${txn.id} lane=1 STATE PENDING->FINALISED`)));
  } finally {
    await h.close();
  }
});

test("$0.51 purchase: declined, errorClass BANK, cashier code; retry is a new attempt on the same sale", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    const operationId = op();
    const first = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 51 });
    const done = await h.until(first.txn.id, (v) => v.final);
    assert.equal(done.financialStatus, "DECLINED");
    assert.equal(done.errorClass, "BANK");
    assert.equal(done.displayMessage, "Insufficient funds [BANK]");
    assert.match(done.merchantReceipt ?? "", /DECLINED/);

    const retry = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    assert.equal(retry.created, true);
    assert.notEqual(retry.txn.id, first.txn.id);
    const old = h.store.txns.get(first.txn.id)!;
    assert.equal(old.operationId, `${operationId}#${first.txn.id}`);
    assert.equal(old.saleOperationId, operationId);
    assert.ok(old.retiredAt);
    await h.until(retry.txn.id, (v) => v.final);
  } finally {
    await h.close();
  }
});

test("create is idempotent on (operationId, kind); a different amount while open is 409", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    const operationId = op();
    const a = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 250 });
    const b = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 250 });
    assert.equal(b.created, false);
    assert.equal(b.txn.id, a.txn.id);
    await assert.rejects(h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 251 }), (e: Error & { statusCode?: number }) => e.statusCode === 409);
    const done = await h.until(a.txn.id, (v) => v.final);
    // Approved: the same id still answers the approved row (never charges twice).
    const c = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 250 });
    assert.equal(c.created, false);
    assert.equal(c.txn.id, done.id);
    assert.equal(h.store.txns.size, 1);
  } finally {
    await h.close();
  }
});

test("signature (.77): PENDING → AWAITING_POS (form without submit_url, auto print) → Approve → FINALISED", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 177 });
    const awaiting = await h.until(txn.id, (v) => v.status === "AWAITING_POS");
    assert.deepEqual(awaiting.autoActions, ["PRINT_MERCHANT_RECEIPT"]);
    assert.match(awaiting.merchantReceipt ?? "", /SIGNATURE/);
    const props = awaiting.actionForm?.properties ?? {};
    assert.equal(props.approve?.submit, true);
    assert.equal(JSON.stringify(awaiting).includes("submit_url"), false);
    assert.equal(JSON.stringify(awaiting).includes(h.fake.url), false);
    await h.engine.idle(); // the loop pauses on AWAITING_POS
    assert.equal(h.engine.activeLoopCount(), 0);

    const after = await h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 7);
    assert.equal(after.status, "FINALISED");
    assert.equal(after.financialStatus, "APPROVED");
    const names = (await h.engine.listEvents(txn.id)).map((e) => e.event);
    for (const e of ["ACTION_SHOWN", "AUTO_ACTION", "TILL_ACTION", "SCI_ACTION_REQ", "SCI_ACTION_RES"]) assert.ok(names.includes(e), e);
    const states = (await h.engine.listEvents(txn.id)).filter((e) => e.event === "STATE").map((e) => `${e.statusBefore}->${e.statusAfter}`);
    assert.deepEqual(states, ["CREATING->PENDING", "PENDING->AWAITING_POS", "AWAITING_POS->FINALISED"]);
  } finally {
    await h.close();
  }
});

test("$0.68 never finalises: deadline → TIMEOUT [TIMEOUT] → override YES recorded with user, late watch ends", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 68 });
    const timedOut = await h.until(txn.id, (v) => v.status === "TIMEOUT");
    assert.equal(timedOut.errorClass, "TIMEOUT");
    assert.equal(timedOut.overrideRequired, true);
    assert.match(timedOut.displayMessage, /\[TIMEOUT\]$/);
    const yes = await h.engine.override(txn.id, { answer: "YES" }, 7);
    assert.equal(yes.status, "FINALISED_BY_OVERRIDE");
    assert.equal(yes.final, true);
    const row = h.store.txns.get(txn.id)!;
    assert.equal(row.overrideAnswer, "YES");
    assert.equal(row.overrideBy, 7);
    await assert.rejects(h.engine.override(txn.id, { answer: "NO" }, 7), (e: Error & { statusCode?: number }) => e.statusCode === 409);
    await h.engine.idle();
    assert.equal(h.engine.activeLoopCount(), 0);
    const names = (await h.engine.listEvents(txn.id)).map((e) => e.event);
    for (const e of ["SCI_POLL_TIMEOUT_404", "DEADLINE", "OVERRIDE"]) assert.ok(names.includes(e), e);
  } finally {
    await h.close();
  }
});

test("signature 401 (wrong part A): FAILED, ERROR event class PAIR; no Signature header or secret in any event or log line", async () => {
  const h = await harness({ enginePartA: "not-the-right-part-a" });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
    const failed = await h.until(txn.id, (v) => v.final);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.errorClass, "PAIR");
    assert.equal(failed.errorCode, "no_valid_signatures_found");
    assert.match(failed.displayMessage, /\[PAIR\]$/);
    const events = await h.engine.listEvents(txn.id);
    const err = events.find((e) => e.event === "ERROR");
    assert.ok(err);
    assert.equal(err.errorClass, "PAIR");
    assert.equal(err.httpStatus, 401);

    const dump = JSON.stringify(events) + "\n" + h.lines.join("\n");
    const sigHeaders = h.sentHeaders.filter((x) => x.Signature).map((x) => x.Signature);
    assert.ok(sigHeaders.length > 0);
    const partB = decryptSecret(h.store.pairings[0].signingSecretPartBEnc, SECRET_KEY);
    for (const s of [...sigHeaders, "sig1=", "Signature-Input", "not-the-right-part-a", PART_A, partB, h.store.pairings[0].keyId, API_KEY])
      assert.equal(dump.includes(s), false, `leaked ${s.slice(0, 12)}…`);
  } finally {
    await h.close();
  }
});

test("terminal offline (424): FAILED [TERM]; FAKE unpaired: pairing goes inactive and the lane refuses with [PAIR]", async () => {
  const h = await harness({ mode: { deviceOffline: true } });
  try {
    const p = await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
    const failed = await h.until(txn.id, (v) => v.final);
    assert.equal(failed.errorClass, "TERM");
    assert.equal(failed.errorCode, "device_not_connected");
    assert.equal(failed.displayMessage, "Terminal not connected — check its network and retry [TERM]");

    h.fake.mode.deviceOffline = false;
    h.fake.mode.unpaired = true;
    const t = await h.engine.testPairing(p.id);
    assert.equal(t.ok, false);
    assert.equal(t.errorCode, "no_active_pairings_found");
    assert.equal(h.store.pairings[0].active, false);
    await assert.rejects(
      h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 }),
      (e: Error & { statusCode?: number }) => e.statusCode === 409 && /\[PAIR\]$/.test(e.message),
    );
    const lanes = await h.engine.lanes();
    assert.equal(lanes.lanes[0].pairing?.active, false);
    assert.equal(lanes.lanes[0].lastSciErrorCode, "no_active_pairings_found");
    assert.equal(lanes.lanes[0].sciReachable, false);
    assert.equal(lanes.lanes[0].lastTransaction?.errorClass, "TERM");
  } finally {
    await h.close();
  }
});

test("lane long poll: holds until the version passes, answers the current state on hold expiry", async () => {
  const h = await harness({ config: { pollDeadlineMs: 60_000 } });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 68 });
    const settled = await h.until(txn.id, (v) => v.message === "Waiting for bank response");
    const started = Date.now();
    const held = await h.engine.getTransaction(txn.id, settled.version + 1, undefined, 250);
    assert.ok(Date.now() - started >= 240);
    assert.equal(held.version, settled.version);
    const immediate = await h.engine.getTransaction(txn.id, null);
    assert.equal(immediate.version, settled.version);
    await assert.rejects(h.engine.getTransaction("nope", 1), (e: Error & { statusCode?: number }) => e.statusCode === 404);
  } finally {
    await h.close();
  }
});

test("boot recovery: CREATING without upstream id → FAILED [POS]; PENDING row resumes and finalises", async () => {
  const h = await harness();
  try {
    await h.pairLane();
    // A live upstream transaction the "previous process" created.
    const a = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 300 });
    await h.until(a.txn.id, (v) => v.status === "PENDING");
    await h.engine.stop();
    const pending = { ...h.store.txns.get(a.txn.id)! };
    assert.equal(pending.status, "PENDING"); // stop() never applies an answer after the stop flag
    const orphan = { ...pending, id: "corphan0001", operationId: "op-orphan-0001", saleOperationId: "op-orphan-0001", status: "CREATING" as const, providerTxnId: null, providerVersion: null };
    h.store.seedTxn(orphan);

    const fresh = new EftEngine({ store: h.store, config: h.config, providerFor: () => new SciProvider({ pairingApiUrl: h.fake.url, pairingApiKey: API_KEY, signingSecretPartA: PART_A }), log: () => undefined });
    try {
      const r = await fresh.recover();
      assert.deepEqual(r, { resumed: 1, failed: 1 });
      const o = await fresh.getTransaction("corphan0001", null);
      assert.equal(o.status, "FAILED");
      assert.equal(o.errorClass, "POS");
      assert.equal(o.errorCode, "RECOVERY_CREATE_UNKNOWN");
      let v = await fresh.getTransaction(a.txn.id, null);
      const end = Date.now() + 5000;
      while (!v.final && Date.now() < end) v = await fresh.getTransaction(a.txn.id, v.version + 1, undefined, 500);
      assert.equal(v.financialStatus, "APPROVED");
      assert.ok((await fresh.listEvents(a.txn.id)).some((e) => e.event === "RECOVERY_RESUME"));
      await fresh.idle();
      assert.equal(fresh.activeLoopCount(), 0);
    } finally {
      await fresh.stop();
    }
  } finally {
    await h.fake.stop();
  }
});

test("not configured: pairing 503 without the pairing key; create 503 without EFT_SECRET_KEY", async () => {
  const h = await harness({ config: { pairingApiKey: "" } });
  try {
    await assert.rejects(h.engine.pair({ pairingCode: "123456" }, null), (e: Error & { statusCode?: number }) => e.statusCode === 503 && e.message === "EFT is not configured");
  } finally {
    await h.close();
  }
  const h2 = await harness({ config: { secretKeyHex: "" } });
  try {
    await assert.rejects(
      h2.engine.createTransaction({ terminalId: 1, eftPairingId: 1, userId: 1 }, { operationId: op(), kind: "PURCHASE", amountCents: 100 }),
      (e: Error & { statusCode?: number }) => e.statusCode === 503,
    );
  } finally {
    await h2.close();
  }
});

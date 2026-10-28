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

type FetchWrap = (url: string, init: RequestInit, next: FetchLike) => Promise<Response>;

async function harness(
  opts: { enginePartA?: string; mode?: Partial<FakeSciMode>; config?: Partial<EftConfig>; fakeHoldMs?: number; fetchWrap?: FetchWrap; anyCode?: boolean } = {},
) {
  const fakeLog: string[] = [];
  const fake = await startFakeSci({ port: 0, partA: PART_A, pairingApiKey: API_KEY, stepMs: 30, holdMs: opts.fakeHoldMs ?? 150, mode: opts.mode, anyCode: opts.anyCode, log: (l) => fakeLog.push(l) });
  const sentHeaders: Record<string, string>[] = [];
  const plain: FetchLike = (url, init) => fetch(url, init);
  const fetchImpl: FetchLike = (url, init) => {
    sentHeaders.push({ ...(init.headers as Record<string, string>) });
    return opts.fetchWrap ? opts.fetchWrap(url, init, plain) : plain(url, init);
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

test("boot recovery: CREATING without upstream id → TIMEOUT [POS] CREATE_UNKNOWN (override); PENDING row resumes and finalises", async () => {
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
      assert.deepEqual(r, { resumed: 1, unresolved: 1 });
      const o = await fresh.getTransaction("corphan0001", null);
      assert.equal(o.status, "TIMEOUT");
      assert.equal(o.errorClass, "POS");
      assert.equal(o.errorCode, "CREATE_UNKNOWN");
      assert.equal(o.overrideRequired, true);
      assert.equal(o.final, false);
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

// ── Codex D-14 review round 1 (F-1 … F-6) ───────────────────────────────────

const lostResponse = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const isCreate = (url: string, init: RequestInit) => init.method === "POST" && new URL(url).pathname === "/v1/transactions";
const isAction = (url: string, init: RequestInit) => init.method === "POST" && new URL(url).searchParams.has("action");

test("F-1: create accepted upstream but the answer is lost → TIMEOUT [NET] CREATE_UNKNOWN; no second create until override NO", async () => {
  let dropCreates = 1;
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (isCreate(url, init) && dropCreates > 0) {
        dropCreates--;
        await next(url, init); // the create lands on the fake…
        throw lostResponse(); // …but our side never sees the answer
      }
      return next(url, init);
    },
  });
  try {
    await h.pairLane();
    const operationId = op();
    const first = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    const unknown = await h.until(first.txn.id, (v) => v.status !== "CREATING");
    assert.equal(unknown.status, "TIMEOUT");
    assert.equal(unknown.errorClass, "NET");
    assert.equal(unknown.errorCode, "CREATE_UNKNOWN");
    assert.equal(unknown.overrideRequired, true);
    assert.equal(unknown.final, false);
    assert.match(unknown.displayMessage, /Was it successful\? \[NET\]$/);
    assert.equal(h.fake.transactions.size, 1);

    // The till retries the same sale: same row back, nothing sent upstream.
    const retry = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    assert.equal(retry.created, false);
    assert.equal(retry.txn.id, first.txn.id);
    await h.engine.idle();
    assert.equal(h.fake.transactions.size, 1);
    assert.equal(h.store.txns.get(first.txn.id)!.operationId, operationId); // key not retired

    // Cashier checked the terminal: not paid → only now a new attempt goes out.
    await h.engine.override(first.txn.id, { answer: "NO" }, 7);
    const again = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    assert.equal(again.created, true);
    const done = await h.until(again.txn.id, (v) => v.final);
    assert.equal(done.financialStatus, "APPROVED");
    assert.equal(h.fake.transactions.size, 2);
  } finally {
    await h.close();
  }
});

test("F-1: a certain refusal (4xx TRANSACTION_REFUSED) is FAILED and may be retried at once", async () => {
  const h = await harness({ mode: { refuse: true } });
  try {
    await h.pairLane();
    const operationId = op();
    const first = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    const failed = await h.until(first.txn.id, (v) => v.final);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.errorCode, "TRANSACTION_REFUSED");
    h.fake.mode.refuse = false;
    const retry = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    assert.equal(retry.created, true);
    await h.until(retry.txn.id, (v) => v.final);
  } finally {
    await h.close();
  }
});

test("F-3: signature Approve accepted upstream but our answer is lost → recovery GET finds the result", async () => {
  let dropActions = 1;
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (isAction(url, init) && dropActions > 0) {
        dropActions--;
        await next(url, init);
        throw lostResponse();
      }
      return next(url, init);
    },
  });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 177 });
    await h.until(txn.id, (v) => v.status === "AWAITING_POS");
    await assert.rejects(h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 7), (e: Error & { statusCode?: number }) => e.statusCode === 502);
    const done = await h.until(txn.id, (v) => v.final);
    assert.equal(done.financialStatus, "APPROVED");
    await h.engine.idle();
    assert.deepEqual(h.engine.memoryStats(), { loops: 0, eventQueues: 0, seqs: 0, locks: 0, actionsInFlight: 0, waiters: 0 });
  } finally {
    await h.close();
  }
});

test("F-3: an action that never reached SCI → back to AWAITING_POS (same form) and the cashier can press again", async () => {
  let dropActions = 1;
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (isAction(url, init) && dropActions > 0) {
        dropActions--;
        throw lostResponse(); // never sent
      }
      return next(url, init);
    },
  });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 177 });
    const awaiting = await h.until(txn.id, (v) => v.status === "AWAITING_POS");
    await assert.rejects(h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 7));
    const reshown = await h.until(txn.id, (v) => v.status === "AWAITING_POS" && v.version > awaiting.version);
    assert.equal(reshown.actionForm?.properties?.approve?.submit, true);
    const done = await h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {}, version: reshown.version }, 7);
    assert.equal(done.financialStatus, "APPROVED");
  } finally {
    await h.close();
  }
});

test("F-4: an error body echoing the Signature header, key id and part B never reaches EftEvent or the log", async () => {
  let partB = "";
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (!isCreate(url, init)) return next(url, init);
      const hd = init.headers as Record<string, string>;
      const keyId = h.store.pairings[0].keyId;
      partB = decryptSecret(h.store.pairings[0].signingSecretPartBEnc, SECRET_KEY);
      const echo = {
        error: {
          code: "no_valid_signatures_found",
          message: `bad signature ${hd.Signature} for ${hd["Signature-Input"]} key=${keyId} secret=${PART_A + partB}`,
          received: { sig: hd.Signature, input: hd["Signature-Input"], k: keyId, b: partB, nested: [`x ${partB} y`] },
        },
      };
      return new Response(JSON.stringify(echo), { status: 401, headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
    const failed = await h.until(txn.id, (v) => v.final);
    assert.equal(failed.errorClass, "PAIR");
    const events = await h.engine.listEvents(txn.id);
    const dump = JSON.stringify(events) + "\n" + h.lines.join("\n");
    assert.ok(dump.includes("no_valid_signatures_found"));
    assert.ok(dump.includes("[redacted]")); // the structured body was kept, with values redacted
    const sig = h.sentHeaders.find((x) => x.Signature)!.Signature;
    for (const secret of [sig, sig.slice(6, -1), "sig1=", h.store.pairings[0].keyId, partB, PART_A])
      assert.equal(dump.includes(secret), false, `leaked ${secret.slice(0, 10)}…`);
  } finally {
    await h.close();
  }
});

test("F-5: the deadline aborts an in-flight long poll — TIMEOUT arrives on time, not after the SCI hold", async () => {
  const h = await harness({ fakeHoldMs: 3000, config: { pollDeadlineMs: 300, lateWatchMs: 100 } });
  try {
    await h.pairLane();
    const t0 = Date.now();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 68 });
    await h.until(txn.id, (v) => v.status === "TIMEOUT", 2500);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1200, `TIMEOUT after ${elapsed} ms (the fake holds polls for 3000 ms)`);
  } finally {
    await h.close();
  }
});

// ── Codex D-14 review round 2 (F-7 … F-9) ───────────────────────────────────

test("F-7: HTTP 500 carrying a known code on create is ambiguous → TIMEOUT CREATE_UNKNOWN; retry returns the same row, one upstream create", async () => {
  let fail500 = 1;
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (isCreate(url, init) && fail500 > 0) {
        fail500--;
        await next(url, init); // landed upstream
        return new Response(JSON.stringify({ error: { code: "device_not_connected" } }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return next(url, init);
    },
  });
  try {
    await h.pairLane();
    const operationId = op();
    const first = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    const v = await h.until(first.txn.id, (x) => x.status !== "CREATING");
    assert.equal(v.status, "TIMEOUT");
    assert.equal(v.errorClass, "NET");
    assert.equal(v.errorCode, "CREATE_UNKNOWN");
    assert.equal(v.overrideRequired, true);
    const retry = await h.engine.createTransaction(h.lane(), { operationId, kind: "PURCHASE", amountCents: 100 });
    assert.equal(retry.created, false);
    assert.equal(retry.txn.id, first.txn.id);
    await h.engine.idle();
    assert.equal(h.fake.transactions.size, 1);
  } finally {
    await h.close();
  }
});

test("F-8: 401/400 bodies reflecting part B in `error` → errorCode HTTP_401 / HTTP_400; the secret appears in no lane answer, event or log line", async () => {
  let partB = "";
  const statuses = [401, 400];
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      if (!isCreate(url, init)) return next(url, init);
      partB = decryptSecret(h.store.pairings[0].signingSecretPartBEnc, SECRET_KEY);
      const status = statuses.shift() ?? 400;
      return new Response(JSON.stringify({ error: partB }), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    await h.pairLane();
    const dumps: string[] = [];
    for (const [expectClass, expectCode] of [["PAIR", "HTTP_401"], ["POS", "HTTP_400"]] as const) {
      const created = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
      const failed = await h.until(created.txn.id, (v) => v.final);
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.errorClass, expectClass);
      assert.equal(failed.errorCode, expectCode);
      dumps.push(JSON.stringify(created), JSON.stringify(failed), JSON.stringify(await h.engine.getTransaction(created.txn.id, null)), JSON.stringify(await h.engine.listEvents(created.txn.id)));
    }
    assert.ok(partB.length > 0);
    const dump = [...dumps, JSON.stringify(await h.engine.lanes()), h.lines.join("\n")].join("\n");
    assert.equal(dump.includes(partB), false, "part B leaked");
  } finally {
    await h.close();
  }
});

test("F-9: lost action response, first recovery GET fails, second succeeds → the unchanged form is re-shown", async () => {
  let dropAction = 1;
  let failRecoveryGet = 0;
  const h = await harness({
    fetchWrap: async (url, init, next) => {
      const u = new URL(url);
      if (isAction(url, init) && dropAction > 0) {
        dropAction--;
        failRecoveryGet = 1;
        throw lostResponse(); // never reached SCI
      }
      if (init.method === "GET" && u.pathname.startsWith("/v1/transactions/") && !u.searchParams.has("min_version") && failRecoveryGet > 0) {
        failRecoveryGet--;
        throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
      }
      return next(url, init);
    },
  });
  try {
    await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 177 });
    const awaiting = await h.until(txn.id, (v) => v.status === "AWAITING_POS");
    await assert.rejects(h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {} }, 7));
    const reshown = await h.until(txn.id, (v) => v.status !== "PENDING");
    assert.equal(reshown.status, "AWAITING_POS");
    assert.ok(reshown.version > awaiting.version);
    assert.equal(failRecoveryGet, 0); // the failing recovery GET did happen
    const errors = (await h.engine.listEvents(txn.id)).filter((e) => e.event === "ERROR" && e.errorClass === "NET");
    assert.ok(errors.length >= 2); // the lost action + the failed recovery GET
    const done = await h.engine.submitAction(txn.id, { buttonKey: "approve", inputs: {}, version: reshown.version }, 7);
    assert.equal(done.financialStatus, "APPROVED");
  } finally {
    await h.close();
  }
});

type LaneErr = Error & { statusCode?: number; result?: { errorClass?: string; errorCode?: string } };

test("T-9 (F-20): fake SCI pairs with 123456 only — 123457 → 400 [PAIR] invalid_pairing_code, nothing stored; anyCode pairs any 6 digits", async () => {
  const h = await harness();
  try {
    await assert.rejects(h.engine.pair({ pairingCode: "123457" }, null), (e: LaneErr) => {
      assert.equal(e.statusCode, 400);
      assert.equal(e.message, "Invalid pairing code — check the code on the terminal [PAIR]");
      assert.equal(e.result?.errorClass, "PAIR");
      assert.equal(e.result?.errorCode, "invalid_pairing_code");
      return true;
    });
    assert.equal(h.store.pairings.length, 0);
    assert.ok(h.lines.some((l) => l === "[eft] pairing PAIR_FAILED PAIR code=invalid_pairing_code 400"));
    const ok = await h.engine.pair({ pairingCode: "123456" }, null);
    assert.equal(ok.confirmationCode, "456456");
  } finally {
    await h.close();
  }
  const any = await harness({ anyCode: true });
  try {
    const a = await any.engine.pair({ pairingCode: "123457" }, null);
    assert.equal(a.confirmationCode, "457457");
    const b = await any.engine.pair({ pairingCode: "654321" }, null);
    assert.equal(b.confirmationCode, "321321");
    assert.equal(any.store.pairings.length, 2);
  } finally {
    await any.close();
  }
});

test("T-9 (F-19): delete pairing — active → 409 [PAIR]; open txn → 409 [POS]; inactive → deleted, lane cleared, past txn + events kept", async () => {
  const h = await harness();
  try {
    const p = await h.pairLane();
    const { txn } = await h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 });
    await h.until(txn.id, (v) => v.final);
    await h.engine.idle();
    const eventsBefore = (await h.engine.listEvents(txn.id)).length;
    assert.ok(eventsBefore > 0);

    await assert.rejects(h.engine.deletePairing(p.id), (e: LaneErr) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.message, "Unpair this terminal before deleting it [PAIR]");
      assert.equal(e.result?.errorCode, "PAIRING_ACTIVE");
      return true;
    });
    assert.equal(h.store.pairings.length, 1);

    await h.engine.unpair(p.id);
    // A transaction on it that is not final blocks the delete.
    const open = await h.store.insertTxn({
      provider: "sci", eftPairingId: p.id, terminalId: 1, kind: "PURCHASE", requestedCents: 500, surchargeCents: 0,
      operationId: op(), saleOperationId: "op-open", createdBy: 7, message: null,
    });
    for (const status of ["CREATING", "TIMEOUT"] as const) {
      await h.store.updateTxn(open.id, { status });
      await assert.rejects(h.engine.deletePairing(p.id), (e: LaneErr) => {
        assert.equal(e.statusCode, 409);
        assert.equal(e.message, "A payment on this terminal is not finished — finish it before deleting [POS]");
        assert.equal(e.result?.errorCode, "PAIRING_IN_USE");
        return true;
      });
    }
    await h.store.updateTxn(open.id, { status: "FINALISED", financialStatus: "UNKNOWN" });
    await assert.rejects(h.engine.deletePairing(p.id), (e: LaneErr) => e.statusCode === 409 && e.result?.errorCode === "PAIRING_IN_USE");
    await h.store.updateTxn(open.id, { status: "CANCELLED_BY_OVERRIDE", overrideAnswer: "NO" });

    assert.equal(h.store.terminals[0].eftPairingId, p.id);
    await h.engine.deletePairing(p.id);
    assert.equal(h.store.pairings.length, 0);
    assert.equal(h.store.terminals[0].eftPairingId, null);
    assert.equal((await h.store.getTxn(txn.id))?.eftPairingId, null);
    assert.equal((await h.engine.listEvents(txn.id)).length, eventsBefore);
    assert.equal((await h.engine.getTransaction(txn.id, null)).financialStatus, "APPROVED");
    assert.deepEqual(await h.engine.listPairings(null), []);
    assert.ok(h.lines.includes(`[eft] pairing=${p.id} DELETED lanes_cleared=1`));
    await assert.rejects(h.engine.deletePairing(p.id), (e: LaneErr) => e.statusCode === 404);
    // The lane now refuses a card payment until another pairing is chosen.
    await assert.rejects(
      h.engine.createTransaction(h.lane(), { operationId: op(), kind: "PURCHASE", amountCents: 100 }),
      (e: LaneErr) => e.statusCode === 409 && e.result?.errorCode === "NO_PAIRING_SELECTED",
    );
  } finally {
    await h.close();
  }
});

// EFT engine (retail-eftpos S-3 §1–§6): provider-neutral state machine, the
// server-side SCI poll loop per transaction, lane long-poll reads, Action
// Framework relay, override, boot recovery, pairing management and the
// append-only event log. Tills / Runner reach it only through eft.router.ts;
// every secret (pairing API key, signing secret parts, key_id, base URL) stays
// in this process.
//
// State machine (our status):
//   CREATING → PENDING → AWAITING_POS → FINALISED (financialStatus set)
//            ↘ FAILED (create refused / unreachable / recovery gap)
//   PENDING|CREATING → TIMEOUT (no SCI progress for pollDeadlineMs) → override
//   TIMEOUT | FINALISED+UNKNOWN → FINALISED_BY_OVERRIDE | CANCELLED_BY_OVERRIDE
// While TIMEOUT (no override answered yet) the loop keeps watching for
// lateWatchMs and a FINALISED answer still applies; after an override a late
// answer is only logged (LATE_RESULT) — override YES is final.
import { HttpException } from "../../libs/exceptions";
import { decryptSecret, encryptSecret } from "./eft.crypto";
import { missingPairingConfig, missingSigningConfig, type EftConfig } from "./eft.config";
import { eftConsoleLine, sanitizeDetail } from "./eft.events";
import { cashierMessage } from "./eft.messages";
import {
  EftDuplicateError,
  type EftStore,
  type NewEvent,
  type PairingRow,
  type TxnPatch,
  type TxnRow,
  type TxnStatus,
} from "./eft.store";
import { VersionWaiters } from "./eft.waiters";
import type {
  ActionForm,
  EftErrorClass,
  EftProvider,
  HttpMeta,
  PairingCredentials,
  PosInstructions,
  ProviderError,
  ProviderTxnAnswer,
} from "./provider";

export const EFT_NOT_CONFIGURED_MSG = "EFT is not configured";

export interface EftEngineDeps {
  store: EftStore;
  config: EftConfig;
  providerFor: (provider: string) => EftProvider;
  log?: (line: string) => void;
  now?: () => number;
}

export interface LaneContext {
  terminalId: number;
  eftPairingId: number | null;
  userId: number | null;
}

type EventInput = Omit<NewEvent, "transactionId" | "seq" | "at">;
type LoopOpts = { fresh?: boolean; recovery?: boolean };
/** `again` = a restart was asked while this loop was running/exiting. */
type LoopHandle = { stop: boolean; wake?: () => void; again?: LoopOpts };

const OPEN_STATUSES: TxnStatus[] = ["CREATING", "PENDING", "AWAITING_POS"];
const OVERRIDDEN: TxnStatus[] = ["FINALISED_BY_OVERRIDE", "CANCELLED_BY_OVERRIDE"];
const OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const MAX_CENTS = 10_000_000; // $100,000 — a typo guard, not a business limit

function isRetryable(row: TxnRow): boolean {
  if (row.status === "FAILED" || row.status === "CANCELLED_BY_OVERRIDE") return true;
  return row.status === "FINALISED" && (row.financialStatus === "DECLINED" || row.financialStatus === "CANCELLED");
}

function overrideRequired(row: TxnRow): boolean {
  if (row.overrideAnswer) return false;
  return row.status === "TIMEOUT" || (row.status === "FINALISED" && row.financialStatus === "UNKNOWN");
}

function isFinal(row: TxnRow): boolean {
  if (row.status === "FAILED" || OVERRIDDEN.includes(row.status)) return true;
  return row.status === "FINALISED" && row.financialStatus !== "UNKNOWN";
}

function posInstructionsOf(row: TxnRow): PosInstructions | null {
  const p = row.posInstructions as unknown;
  return p && typeof p === "object" ? (p as PosInstructions) : null;
}

/** action_form for the till: submit_url (the SCI base URL) never leaves the server. */
export function clientActionForm(form: ActionForm | null | undefined): ActionForm | null {
  if (!form) return null;
  const properties: ActionForm["properties"] = {};
  for (const [key, prop] of Object.entries(form.properties ?? {})) {
    const { submit_url, ...rest } = prop ?? {};
    properties[key] = submit_url ? { ...rest, submit: true } : rest;
  }
  return { ...form, properties };
}

export function laneView(row: TxnRow) {
  const pos = posInstructionsOf(row);
  return {
    id: row.id,
    version: row.version,
    kind: row.kind,
    operationId: row.saleOperationId,
    amountCents: row.requestedCents,
    surchargeCents: row.surchargeCents,
    status: row.status,
    message: row.message,
    displayMessage: cashierMessage({
      status: row.status,
      financialStatus: row.financialStatus,
      message: row.message,
      errorClass: row.errorClass,
      errorCode: row.errorCode,
      overrideAnswer: row.overrideAnswer,
    }),
    financialStatus: row.financialStatus,
    resultAmounts: row.resultAmounts,
    merchantReceipt: row.merchantReceipt,
    customerReceipt: row.customerReceipt,
    cardDetails: row.cardDetails,
    actionForm: clientActionForm(pos?.action_form),
    autoActions: pos?.auto_actions ?? [],
    merchantPrintSeq: row.merchantPrintSeq,
    customerPrintSeq: row.customerPrintSeq,
    errorClass: row.errorClass,
    errorCode: row.errorCode,
    overrideAnswer: row.overrideAnswer,
    overrideRequired: overrideRequired(row),
    final: isFinal(row),
    cancelRequested: row.cancelRequestedAt != null,
    invoiceId: row.invoiceId,
    startedAt: row.startedAt,
    finalisedAt: row.finalisedAt,
  };
}
export type LaneTxnView = ReturnType<typeof laneView>;

export function pairingView(p: PairingRow, selectedPairingId: number | null) {
  return {
    id: p.id,
    provider: p.provider,
    pairingId: p.pairingId,
    nickname: p.pairingNickname,
    terminalNickname: p.terminalNickname,
    tid: p.tid,
    active: p.active,
    lastTestAt: p.lastTestAt,
    lastTestOk: p.lastTestOk,
    lastError: p.lastError,
    selectedForThisTerminal: selectedPairingId === p.id,
  };
}

function laneError(status: number, message: string, errorClass: EftErrorClass, errorCode: string) {
  return new HttpException(status, `${message} [${errorClass}]`, { errorClass, errorCode });
}

export class EftEngine {
  private readonly store: EftStore;
  private readonly cfg: EftConfig;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly waiters = new VersionWaiters();
  private readonly loops = new Map<string, LoopHandle>();
  private readonly loopDone = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly seqs = new Map<string, number>();
  private readonly eventQueue = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(private readonly deps: EftEngineDeps) {
    this.store = deps.store;
    this.cfg = deps.config;
    this.log = deps.log ?? ((l) => console.log(l));
    this.now = deps.now ?? Date.now;
  }

  get config(): EftConfig {
    return this.cfg;
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(key, chained);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  private emit(txn: { id: string; terminalId: number }, e: EventInput): Promise<void> {
    const detail = sanitizeDetail(e.detail);
    this.log(
      eftConsoleLine({
        txnId: txn.id,
        terminalId: txn.terminalId,
        event: e.event,
        errorClass: e.errorClass,
        errorCode: e.errorCode,
        httpStatus: e.httpStatus,
        durationMs: e.durationMs,
        statusBefore: e.statusBefore,
        statusAfter: e.statusAfter,
      }),
    );
    const prev = this.eventQueue.get(txn.id) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        let seq = this.seqs.get(txn.id);
        if (seq == null) seq = await this.store.maxEventSeq(txn.id);
        seq += 1;
        this.seqs.set(txn.id, seq);
        await this.store.appendEvent({ ...e, detail, transactionId: txn.id, seq, at: new Date(this.now()) });
      })
      .catch((err) => {
        console.error(`[eft] txn=${txn.id} event write failed: ${err instanceof Error ? err.message : err}`);
      });
    this.eventQueue.set(txn.id, next);
    return next;
  }

  private httpFields(http: HttpMeta | null | undefined) {
    return http
      ? { httpMethod: http.method, httpPath: http.path, httpStatus: http.status, durationMs: http.durationMs }
      : {};
  }

  private async update(id: string, patch: TxnPatch, bump = true): Promise<TxnRow> {
    const row = await this.store.updateTxn(id, patch, { bump });
    if (bump) this.waiters.notify(id);
    return row;
  }

  private creds(pairing: PairingRow): PairingCredentials {
    return {
      pairingId: pairing.pairingId,
      keyId: pairing.keyId,
      signingSecretPartB: decryptSecret(pairing.signingSecretPartBEnc, this.cfg.secretKeyHex),
      baseUrl: pairing.baseUrl,
    };
  }

  private async notePairing(pairing: PairingRow, outcome: { ok: true } | { ok: false; error: ProviderError }) {
    try {
      if (outcome.ok) {
        await this.store.updatePairing(pairing.id, { lastSciOkAt: new Date(this.now()) });
      } else if (outcome.error.errorClass !== "POS") {
        await this.store.updatePairing(pairing.id, {
          lastSciErrorAt: new Date(this.now()),
          lastSciErrorCode: outcome.error.errorCode,
          ...(outcome.error.unpaired ? { active: false, lastError: "no_active_pairings_found" } : {}),
        });
      }
    } catch (err) {
      console.error(`[eft] pairing=${pairing.id} diagnostics write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async failTxn(row: TxnRow, err: { errorClass: EftErrorClass; errorCode: string; message?: string }, http?: HttpMeta | null) {
    await this.emit(row, {
      source: "SERVER",
      event: "ERROR",
      errorClass: err.errorClass,
      errorCode: err.errorCode,
      ...this.httpFields(http),
      detail: { message: err.message ?? null },
    });
    const updated = await this.update(row.id, {
      status: "FAILED",
      errorClass: err.errorClass,
      errorCode: err.errorCode,
      finalisedAt: new Date(this.now()),
    });
    await this.emit(row, { source: "SERVER", event: "STATE", statusBefore: row.status, statusAfter: "FAILED", errorClass: err.errorClass, errorCode: err.errorCode });
    return updated;
  }

  // ── state machine: apply one provider answer ──────────────────────────────

  /** Returns true when the answer moved the row (new provider version). */
  private applyAnswer(id: string, ans: ProviderTxnAnswer, source: "SCI_POLL" | "SCI_CREATE" | "SCI_ACTION"): Promise<boolean> {
    return this.withLock(`txn:${id}`, async () => {
      const row = await this.store.getTxn(id);
      if (!row) return false;
      if (row.providerTxnId && row.providerTxnId !== ans.providerTxnId) {
        await this.emit(row, { source: "SERVER", event: "ERROR", errorClass: "POS", errorCode: "PROVIDER_ID_MISMATCH" });
        return false;
      }
      if (row.providerVersion != null && ans.providerVersion <= row.providerVersion) return false;

      if (OVERRIDDEN.includes(row.status)) {
        // Override is final: record what the bank said, never change the sale.
        await this.update(id, { providerVersion: ans.providerVersion }, false);
        if (ans.status === "FINALISED") {
          await this.emit(row, {
            source: "SCI",
            event: "LATE_RESULT",
            providerVersion: ans.providerVersion,
            detail: { financialStatus: ans.financialStatus, overrideAnswer: row.overrideAnswer, message: ans.message },
          });
        }
        return true;
      }
      if (row.status === "FAILED" || (row.status === "FINALISED" && row.financialStatus !== "UNKNOWN")) return false;

      const patch: TxnPatch = {
        providerTxnId: ans.providerTxnId,
        providerVersion: ans.providerVersion,
        status: ans.status,
        message: ans.message,
        posInstructions: ans.posInstructions,
      };
      if (ans.merchantReceipt != null) patch.merchantReceipt = ans.merchantReceipt;
      if (ans.customerReceipt != null) patch.customerReceipt = ans.customerReceipt;
      if (ans.cardDetails) patch.cardDetails = ans.cardDetails;
      if (ans.resultAmounts) patch.resultAmounts = ans.resultAmounts;
      if (ans.status === "FINALISED") {
        patch.financialStatus = ans.financialStatus ?? "UNKNOWN";
        patch.finalisedAt = new Date(this.now());
        if (patch.financialStatus === "APPROVED") {
          patch.errorClass = null;
          patch.errorCode = null;
        } else if (patch.financialStatus === "UNKNOWN") {
          patch.errorClass = "TIMEOUT";
          patch.errorCode = "RESULT_UNKNOWN";
        } else {
          patch.errorClass = "BANK";
          patch.errorCode = patch.financialStatus;
        }
      } else if (row.status === "TIMEOUT") {
        patch.errorClass = null;
        patch.errorCode = null;
      }
      const updated = await this.update(id, patch);
      if (row.status !== updated.status) {
        await this.emit(row, {
          source: "SERVER",
          event: "STATE",
          providerVersion: ans.providerVersion,
          statusBefore: row.status,
          statusAfter: updated.status,
          errorClass: updated.errorClass,
          errorCode: updated.errorCode,
          detail: { financialStatus: updated.financialStatus, message: ans.message, via: source },
        });
      }
      const form = ans.posInstructions?.action_form;
      if (form) {
        const props = Object.entries(form.properties ?? {});
        await this.emit(row, {
          source: "SCI",
          event: "ACTION_SHOWN",
          providerVersion: ans.providerVersion,
          detail: {
            buttons: props.filter(([, p]) => p?.type === "button").map(([k, p]) => ({ key: k, action: p?.action ?? null, submit: !!p?.submit_url })),
            inputs: props.filter(([, p]) => p?.type === "input").map(([k, p]) => p?.name ?? k),
          },
        });
      }
      for (const action of ans.posInstructions?.auto_actions ?? []) {
        await this.emit(row, { source: "SCI", event: "AUTO_ACTION", providerVersion: ans.providerVersion, detail: { action } });
      }
      return true;
    });
  }

  // ── server-side poll loop (one per open transaction) ──────────────────────

  activeLoopCount(): number {
    return this.loops.size;
  }

  private startLoop(id: string, opts: LoopOpts = {}): void {
    if (this.stopped) return;
    const running = this.loops.get(id);
    if (running) {
      // Re-check once it exits (it may be leaving on the state we just changed).
      running.again = { ...running.again, ...opts, fresh: false };
      return;
    }
    const handle: LoopHandle = { stop: false };
    this.loops.set(id, handle);
    const done = this.runLoop(id, handle, opts)
      .catch(async (err) => {
        console.error(`[eft] txn=${id} loop crashed: ${err instanceof Error ? err.message : err}`);
        const row = await this.store.getTxn(id).catch(() => null);
        if (row && OPEN_STATUSES.includes(row.status)) {
          await this.failTxn(row, { errorClass: "POS", errorCode: "LOOP_CRASH", message: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
        }
      })
      .finally(async () => {
        this.loops.delete(id);
        this.loopDone.delete(id);
        if (handle.again && !handle.stop && !this.stopped) {
          this.startLoop(id, handle.again);
          return;
        }
        await (this.eventQueue.get(id) ?? Promise.resolve());
        if (!this.loops.has(id)) {
          this.eventQueue.delete(id);
          this.seqs.delete(id);
        }
      });
    this.loopDone.set(id, done);
  }

  private sleep(ms: number, handle: LoopHandle): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        handle.wake = undefined;
        resolve();
      }, ms);
      handle.wake = () => {
        clearTimeout(t);
        handle.wake = undefined;
        resolve();
      };
    });
  }

  private async runLoop(id: string, handle: LoopHandle, opts: LoopOpts) {
    let row = await this.store.getTxn(id);
    if (!row) return;
    const pairing = await this.store.getPairing(row.eftPairingId);
    if (!pairing) return void (await this.failTxn(row, { errorClass: "PAIR", errorCode: "PAIRING_MISSING" }));
    let creds: PairingCredentials;
    try {
      creds = this.creds(pairing);
    } catch {
      return void (await this.failTxn(row, { errorClass: "POS", errorCode: "SECRET_UNREADABLE", message: "part B could not be decrypted with EFT_SECRET_KEY" }));
    }
    const provider = this.deps.providerFor(row.provider);

    if (row.status === "CREATING") {
      if (!opts.fresh) return;
      await this.emit(row, { source: "SERVER", event: "SCI_CREATE_REQ", httpMethod: "POST", httpPath: "/v1/transactions", detail: { kind: row.kind, amountCents: row.requestedCents, surchargeCents: row.surchargeCents } });
      const res = await provider.createTransaction(creds, { kind: row.kind, amountCents: row.requestedCents, surchargeCents: row.surchargeCents });
      await this.notePairing(pairing, res.ok ? { ok: true } : { ok: false, error: res.error });
      if (!res.ok) {
        await this.emit(row, { source: "SCI", event: "SCI_CREATE_RES", ...this.httpFields(res.http), errorClass: res.error.errorClass, errorCode: res.error.errorCode, detail: res.error.detail });
        await this.failTxn(row, res.error, res.http);
        return;
      }
      await this.emit(row, { source: "SCI", event: "SCI_CREATE_RES", ...this.httpFields(res.http), providerVersion: res.value.providerVersion, detail: { status: res.value.status, message: res.value.message } });
      await this.applyAnswer(id, res.value, "SCI_CREATE");
    }

    let lastProgress = this.now();
    let lateSince: number | null = null;
    let recoveryFirst = !!opts.recovery;
    while (!handle.stop && !this.stopped) {
      row = await this.store.getTxn(id);
      if (!row) return;
      if (row.status === "FINALISED" || row.status === "FAILED" || row.status === "CREATING") return;
      if (row.status === "AWAITING_POS" && !recoveryFirst) return; // paused until an action relay
      const late = row.status === "TIMEOUT" || OVERRIDDEN.includes(row.status);
      if (late) {
        lateSince ??= this.now();
        if (this.now() - lateSince > this.cfg.lateWatchMs) return;
      } else if (this.now() - lastProgress > this.cfg.pollDeadlineMs) {
        await this.emit(row, { source: "SERVER", event: "DEADLINE", errorClass: "TIMEOUT", errorCode: "DEADLINE", detail: { deadlineMs: this.cfg.pollDeadlineMs } });
        await this.withLock(`txn:${id}`, async () => {
          const cur = await this.store.getTxn(id);
          if (!cur || (cur.status !== "PENDING" && cur.status !== "CREATING")) return;
          await this.update(id, { status: "TIMEOUT", errorClass: "TIMEOUT", errorCode: "DEADLINE" });
          await this.emit(cur, { source: "SERVER", event: "STATE", statusBefore: cur.status, statusAfter: "TIMEOUT", errorClass: "TIMEOUT", errorCode: "DEADLINE" });
        });
        lateSince = this.now();
        continue;
      }
      if (!row.providerTxnId) return void (await this.failTxn(row, { errorClass: "POS", errorCode: "NO_PROVIDER_TXN_ID" }));

      const minVersion = recoveryFirst ? undefined : (row.providerVersion ?? 0) + 1;
      recoveryFirst = false;
      await this.emit(row, { source: "SERVER", event: "SCI_POLL_REQ", httpMethod: "GET", httpPath: "/v1/transactions/{id}", detail: { minVersion: minVersion ?? null } });
      const res = await provider.pollTransaction(creds, row.providerTxnId, minVersion);
      if (handle.stop || this.stopped) return;
      if (res.ok && res.value.kind === "not_yet") {
        await this.emit(row, { source: "SCI", event: "SCI_POLL_TIMEOUT_404", ...this.httpFields(res.http) });
        await this.notePairing(pairing, { ok: true });
        continue;
      }
      if (res.ok && res.value.kind === "answer") {
        const a = res.value.answer;
        await this.emit(row, { source: "SCI", event: "SCI_POLL_RES", ...this.httpFields(res.http), providerVersion: a.providerVersion, detail: { status: a.status, financialStatus: a.financialStatus, message: a.message } });
        await this.notePairing(pairing, { ok: true });
        if (await this.applyAnswer(id, a, "SCI_POLL")) lastProgress = this.now();
        const after = await this.store.getTxn(id);
        if (after && OVERRIDDEN.includes(after.status) && a.status === "FINALISED") return;
        continue;
      }
      if (!res.ok) {
        await this.emit(row, { source: "SCI", event: "ERROR", ...this.httpFields(res.http), errorClass: res.error.errorClass, errorCode: res.error.errorCode, detail: res.error.detail ?? { message: res.error.message } });
        await this.notePairing(pairing, { ok: false, error: res.error });
        // Once a create has landed only an answer or the override closes the
        // row — every poll error is retried until the deadline.
        await this.sleep(late ? this.cfg.retryBackoffMs * 5 : this.cfg.retryBackoffMs, handle);
      }
    }
  }

  // ── lane API operations ───────────────────────────────────────────────────

  async createTransaction(lane: LaneContext, body: unknown): Promise<{ created: boolean; txn: LaneTxnView }> {
    const b = (body ?? {}) as Record<string, unknown>;
    const operationId = typeof b.operationId === "string" ? b.operationId.trim() : "";
    if (!OPERATION_ID_RE.test(operationId)) throw new HttpException(400, "operationId must be 8-64 letters, digits or dashes");
    const kind = b.kind ?? "PURCHASE";
    if (kind !== "PURCHASE" && kind !== "REFUND") throw new HttpException(400, "kind must be PURCHASE or REFUND");
    const amountCents = b.amountCents;
    if (!Number.isInteger(amountCents) || (amountCents as number) <= 0 || (amountCents as number) > MAX_CENTS)
      throw new HttpException(400, "amountCents must be a positive integer (cents)");
    const surchargeCents = b.surchargeCents == null ? 0 : b.surchargeCents;
    if (!Number.isInteger(surchargeCents) || (surchargeCents as number) < 0 || (surchargeCents as number) > MAX_CENTS)
      throw new HttpException(400, "surchargeCents must be a non-negative integer (cents)");
    if (kind === "REFUND" && surchargeCents !== 0) throw new HttpException(400, "a refund carries no surcharge");

    if (missingSigningConfig(this.cfg).length) throw new HttpException(503, EFT_NOT_CONFIGURED_MSG);
    if (lane.eftPairingId == null) throw laneError(409, "No payment terminal selected for this lane", "PAIR", "NO_PAIRING_SELECTED");
    const pairing = await this.store.getPairing(lane.eftPairingId);
    if (!pairing) throw laneError(409, "No payment terminal selected for this lane", "PAIR", "NO_PAIRING_SELECTED");
    if (!pairing.active) throw laneError(409, "Payment terminal is not paired — pair it in Settings", "PAIR", "PAIRING_INACTIVE");

    return this.withLock(`op:${operationId}:${kind}`, async () => {
      const existing = await this.store.findTxnByOperation(operationId, kind);
      if (existing) {
        if (!isRetryable(existing)) {
          if (existing.requestedCents !== amountCents || existing.surchargeCents !== surchargeCents)
            throw laneError(409, "This sale already has a card payment for a different amount", "POS", "AMOUNT_MISMATCH");
          if (OPEN_STATUSES.includes(existing.status) && existing.status !== "CREATING" && existing.status !== "AWAITING_POS")
            this.startLoop(existing.id); // no-op when already running
          return { created: false, txn: laneView(existing) };
        }
        // A new attempt after a decline / failure: retire the old row's key.
        await this.update(existing.id, { operationId: `${operationId}#${existing.id}`, retiredAt: new Date(this.now()) }, false);
      }
      let row: TxnRow;
      try {
        row = await this.store.insertTxn({
          provider: pairing.provider,
          eftPairingId: pairing.id,
          terminalId: lane.terminalId,
          kind,
          requestedCents: amountCents as number,
          surchargeCents: surchargeCents as number,
          operationId,
          saleOperationId: operationId,
          createdBy: lane.userId,
          message: null,
        });
      } catch (e) {
        if (e instanceof EftDuplicateError) {
          const again = await this.store.findTxnByOperation(operationId, kind);
          if (again) return { created: false, txn: laneView(again) };
        }
        throw e;
      }
      await this.emit(row, {
        source: "TILL",
        event: "TILL_CREATE",
        detail: { kind, amountCents, surchargeCents, operationId, userId: lane.userId, retries: existing?.id ?? null },
      });
      this.startLoop(row.id, { fresh: true });
      return { created: true, txn: laneView(row) };
    });
  }

  /** Lane long poll (D-4): answers once version ≥ minVersion, or the current state after holdMs. */
  async getTransaction(id: string, minVersion: number | null, signal?: AbortSignal, holdMs = this.cfg.laneHoldMs): Promise<LaneTxnView> {
    let row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    if (minVersion == null || row.version >= minVersion) return laneView(row);
    const until = this.now() + holdMs;
    for (;;) {
      const remaining = until - this.now();
      if (remaining <= 0 || signal?.aborted) return laneView(row);
      // Wake on a bump; re-read the DB at most every 5 s as a fallback.
      await this.waiters.wait(id, Math.min(remaining, 5_000), signal);
      row = (await this.store.getTxn(id)) ?? row;
      if (row.version >= minVersion) return laneView(row);
    }
  }

  async listEvents(id: string) {
    const row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    await (this.eventQueue.get(id) ?? Promise.resolve());
    return this.store.listEvents(id);
  }

  async submitAction(id: string, body: unknown, userId: number | null): Promise<LaneTxnView> {
    const b = (body ?? {}) as Record<string, unknown>;
    const buttonKey = typeof b.buttonKey === "string" ? b.buttonKey : "";
    const rawInputs = b.inputs ?? {};
    if (!buttonKey) throw new HttpException(400, "buttonKey is required");
    if (!rawInputs || typeof rawInputs !== "object" || Array.isArray(rawInputs)) throw new HttpException(400, "inputs must be an object of name → value");
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawInputs as Record<string, unknown>)) {
      if (typeof v !== "string" || v.length > 512) throw new HttpException(400, `input ${k} must be a string`);
      inputs[k] = v;
    }

    const row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    if (row.status !== "AWAITING_POS") throw laneError(409, "No action is waiting on this payment", "POS", "NOT_AWAITING_POS");
    const prop = posInstructionsOf(row)?.action_form?.properties?.[buttonKey];
    if (!prop || prop.type !== "button") throw new HttpException(400, `unknown button ${buttonKey}`);
    await this.emit(row, { source: "TILL", event: "TILL_ACTION", detail: { buttonKey, inputNames: Object.keys(inputs), action: prop.action ?? null, userId } });

    if (typeof prop.submit_url === "string" && prop.submit_url) {
      const pairing = await this.store.getPairing(row.eftPairingId);
      if (!pairing) throw laneError(409, "Payment terminal is not paired", "PAIR", "PAIRING_MISSING");
      const provider = this.deps.providerFor(row.provider);
      await this.emit(row, { source: "SERVER", event: "SCI_ACTION_REQ", httpMethod: "POST", detail: { buttonKey } });
      const res = await provider.submitAction(this.creds(pairing), prop.submit_url, inputs);
      await this.notePairing(pairing, res.ok ? { ok: true } : { ok: false, error: res.error });
      if (!res.ok) {
        await this.emit(row, { source: "SCI", event: "SCI_ACTION_RES", ...this.httpFields(res.http), errorClass: res.error.errorClass, errorCode: res.error.errorCode });
        await this.emit(row, { source: "SERVER", event: "ERROR", errorClass: res.error.errorClass, errorCode: res.error.errorCode, ...this.httpFields(res.http), detail: res.error.detail ?? { message: res.error.message } });
        throw laneError(502, "The action did not reach the payment service — try again", res.error.errorClass, res.error.errorCode);
      }
      await this.emit(row, { source: "SCI", event: "SCI_ACTION_RES", ...this.httpFields(res.http), providerVersion: res.value?.providerVersion ?? null });
      if (res.value) await this.applyAnswer(id, res.value, "SCI_ACTION");
      const after = await this.store.getTxn(id);
      if (after && after.status === "AWAITING_POS" && (!res.value || res.value.providerVersion <= (row.providerVersion ?? 0))) {
        // No new form came back: resume polling for the next version.
        await this.withLock(`txn:${id}`, async () => {
          await this.update(id, { status: "PENDING", message: "Processing…" });
          await this.emit(row, { source: "SERVER", event: "STATE", statusBefore: "AWAITING_POS", statusAfter: "PENDING" });
        });
      }
      const cur = await this.store.getTxn(id);
      if (cur && cur.status === "PENDING") this.startLoop(id);
      return laneView(cur ?? row);
    }

    const action = prop.action;
    let updated: TxnRow;
    switch (action) {
      case "PRINT_MERCHANT_RECEIPT":
        updated = await this.update(id, { merchantPrintSeq: row.merchantPrintSeq + 1 });
        break;
      case "PRINT_CUSTOMER_RECEIPT":
        updated = await this.update(id, { customerPrintSeq: row.customerPrintSeq + 1 });
        break;
      case "TRANSACTION_COMPLETE":
        // The POS acknowledged; read the transaction's current state again.
        updated = await this.update(id, { status: "PENDING" });
        await this.emit(row, { source: "SERVER", event: "STATE", statusBefore: "AWAITING_POS", statusAfter: "PENDING" });
        this.startLoop(id, { recovery: true });
        break;
      case "RETRY_TRANSACTION":
        updated = await this.failTxn(row, { errorClass: "TERM", errorCode: "RETRY_REQUESTED", message: "terminal asked the POS to retry" });
        break;
      case "TEST_ACTION":
        updated = await this.update(id, {});
        break;
      default:
        throw new HttpException(400, `action ${String(action)} is not supported for a payment`);
    }
    return laneView(updated);
  }

  async override(id: string, body: unknown, userId: number | null): Promise<LaneTxnView> {
    const answer = (body as Record<string, unknown> | null)?.answer;
    if (answer !== "YES" && answer !== "NO") throw new HttpException(400, 'answer must be "YES" or "NO"');
    return this.withLock(`txn:${id}`, async () => {
      const row = await this.store.getTxn(id);
      if (!row) throw new HttpException(404, "EFT transaction not found");
      if (!overrideRequired(row)) throw laneError(409, "This payment does not need a manual answer", "POS", "OVERRIDE_NOT_ALLOWED");
      const status = answer === "YES" ? "FINALISED_BY_OVERRIDE" : "CANCELLED_BY_OVERRIDE";
      const at = new Date(this.now());
      const updated = await this.update(id, { status, overrideAnswer: answer, overrideBy: userId, overrideAt: at, finalisedAt: at });
      await this.emit(row, { source: "TERMINAL_OP", event: "OVERRIDE", detail: { answer, userId } });
      await this.emit(row, { source: "SERVER", event: "STATE", statusBefore: row.status, statusAfter: status });
      return laneView(updated);
    });
  }

  async cancel(id: string, userId: number | null): Promise<LaneTxnView> {
    const row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    if (!OPEN_STATUSES.includes(row.status)) throw laneError(409, "This payment has already finished", "POS", "NOT_OPEN");
    await this.emit(row, { source: "TILL", event: "TILL_CANCEL", detail: { userId } });
    const pairing = await this.store.getPairing(row.eftPairingId);
    if (pairing && row.providerTxnId) {
      const r = await this.deps.providerFor(row.provider).cancel(this.creds(pairing), row.providerTxnId);
      if ("ok" in r && !r.ok)
        await this.emit(row, { source: "SCI", event: "ERROR", errorClass: r.error.errorClass, errorCode: r.error.errorCode, ...this.httpFields(r.http) });
    }
    // A-4: no upstream cancel call — the cashier cancels on the terminal and
    // the running poll carries the result.
    const updated = await this.update(id, { cancelRequestedAt: new Date(this.now()) });
    return laneView(updated);
  }

  // ── boot recovery (S-3 §4) ────────────────────────────────────────────────

  async recover(): Promise<{ resumed: number; failed: number }> {
    const rows = await this.store.listTxnsByStatus(OPEN_STATUSES);
    let resumed = 0;
    let failed = 0;
    for (const row of rows) {
      if (this.loops.has(row.id)) continue;
      if (row.status === "CREATING" && !row.providerTxnId) {
        // A-5: the create may or may not have reached the provider.
        await this.emit(row, { source: "SERVER", event: "RECOVERY_RESUME", detail: { status: row.status, outcome: "create outcome unknown" } });
        await this.failTxn(row, { errorClass: "POS", errorCode: "RECOVERY_CREATE_UNKNOWN", message: "server stopped while the create was in flight" });
        failed++;
        continue;
      }
      if (row.status === "CREATING") await this.update(row.id, { status: "PENDING" });
      await this.emit(row, { source: "SERVER", event: "RECOVERY_RESUME", detail: { status: row.status, providerVersion: row.providerVersion } });
      this.startLoop(row.id, { recovery: true });
      resumed++;
    }
    if (rows.length) this.log(`[eft] recovery: resumed=${resumed} failed=${failed}`);
    return { resumed, failed };
  }

  /** Stop every loop (shutdown / tests) and wait for them to exit. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const h of this.loops.values()) {
      h.stop = true;
      h.wake?.();
    }
    await Promise.all([...this.loopDone.values()]);
  }

  /** Wait until no loop is running (tests). */
  async idle(): Promise<void> {
    while (this.loopDone.size) await Promise.all([...this.loopDone.values()]);
  }

  // ── pairings ──────────────────────────────────────────────────────────────

  async listPairings(selectedPairingId: number | null) {
    const rows = await this.store.listPairings();
    return rows.map((p) => pairingView(p, selectedPairingId));
  }

  async pair(body: unknown, selectedPairingId: number | null) {
    if (missingPairingConfig(this.cfg).length) throw new HttpException(503, EFT_NOT_CONFIGURED_MSG);
    const b = (body ?? {}) as Record<string, unknown>;
    const pairingCode = typeof b.pairingCode === "string" ? b.pairingCode.trim() : "";
    if (!/^[A-Za-z0-9-]{4,32}$/.test(pairingCode)) throw new HttpException(400, "pairingCode is required (the code shown on the terminal)");
    const nickname = typeof b.nickname === "string" && b.nickname.trim() ? b.nickname.trim().slice(0, 64) : null;
    const provider = this.deps.providerFor("sci");
    const res = await provider.pair({ pairingCode, nickname });
    if (!res.ok) {
      this.log(`[eft] pairing PAIR_FAILED ${res.error.errorClass} code=${res.error.errorCode}${res.http?.status != null ? ` ${res.http.status}` : ""}`);
      const status = res.error.errorClass === "NET" ? 502 : 400;
      const msg = res.error.errorClass === "NET" ? "Could not reach the pairing service" : "Pairing was not accepted — check the code on the terminal";
      throw laneError(status, msg, res.error.errorClass, res.error.errorCode);
    }
    const v = res.value;
    const row = await this.store.upsertPairing({
      provider: "sci",
      pairingId: v.pairingId,
      keyId: v.keyId,
      signingSecretPartBEnc: encryptSecret(v.signingSecretPartB, this.cfg.secretKeyHex),
      baseUrl: v.baseUrl,
      tid: v.tid,
      pairingNickname: v.pairingNickname ?? nickname,
      terminalNickname: v.terminalNickname,
    });
    this.log(`[eft] pairing=${row.id} PAIRED tid=${row.tid ?? "-"}`);
    return { ...pairingView(row, selectedPairingId), confirmationCode: v.confirmationCode };
  }

  private async pairingOr404(id: number): Promise<PairingRow> {
    const p = Number.isInteger(id) ? await this.store.getPairing(id) : null;
    if (!p) throw new HttpException(404, "Pairing not found");
    return p;
  }

  async testPairing(id: number) {
    const p = await this.pairingOr404(id);
    if (missingSigningConfig(this.cfg).length) throw new HttpException(503, EFT_NOT_CONFIGURED_MSG);
    const res = await this.deps.providerFor(p.provider).pairingInfo(this.creds(p));
    const at = new Date(this.now());
    if (res.ok) {
      await this.store.updatePairing(p.id, { lastTestAt: at, lastTestOk: true, active: true, lastError: null, lastSciOkAt: at });
      this.log(`[eft] pairing=${p.id} PAIR_TEST ok ${res.http.status ?? ""} ${res.http.durationMs}ms`);
      return { ok: true, lastTestAt: at, errorClass: null, errorCode: null, message: "Paired" };
    }
    await this.store.updatePairing(p.id, {
      lastTestAt: at,
      lastTestOk: false,
      lastError: `${res.error.errorClass} ${res.error.errorCode}`,
      lastSciErrorAt: at,
      lastSciErrorCode: res.error.errorCode,
      ...(res.error.unpaired ? { active: false } : {}),
    });
    this.log(`[eft] pairing=${p.id} PAIR_TEST ${res.error.errorClass} code=${res.error.errorCode}${res.http?.status != null ? ` ${res.http.status}` : ""}`);
    return {
      ok: false,
      lastTestAt: at,
      errorClass: res.error.errorClass,
      errorCode: res.error.errorCode,
      message: res.error.unpaired ? "Not paired — pair again from the terminal [PAIR]" : `${res.error.message} [${res.error.errorClass}]`,
    };
  }

  async unpair(id: number) {
    const p = await this.pairingOr404(id);
    if (missingSigningConfig(this.cfg).length) throw new HttpException(503, EFT_NOT_CONFIGURED_MSG);
    const res = await this.deps.providerFor(p.provider).unpair(this.creds(p));
    if (!res.ok && !res.error.unpaired) {
      this.log(`[eft] pairing=${p.id} UNPAIR_FAILED ${res.error.errorClass} code=${res.error.errorCode}`);
      throw laneError(502, "Unpair did not reach the payment service", res.error.errorClass, res.error.errorCode);
    }
    await this.store.updatePairing(p.id, { active: false, lastError: "unpaired" });
    this.log(`[eft] pairing=${p.id} UNPAIRED`);
    return { ok: true };
  }

  async selectPairing(terminalId: number, id: number | null) {
    if (id != null) await this.pairingOr404(id);
    await this.store.setTerminalPairing(terminalId, id);
    this.log(`[eft] lane=${terminalId} SELECT pairing=${id ?? "none"}`);
    return { terminalId, eftPairingId: id };
  }

  // ── diagnostics (D-5) ─────────────────────────────────────────────────────

  async lanes() {
    const [terminals, pairings] = await Promise.all([this.store.listLaneTerminals(), this.store.listPairings()]);
    const byId = new Map(pairings.map((p) => [p.id, p]));
    const lanes = [];
    for (const t of terminals) {
      const p = t.eftPairingId != null ? byId.get(t.eftPairingId) ?? null : null;
      const last = await this.store.lastTxnForTerminal(t.id);
      const okAt = p?.lastSciOkAt?.getTime() ?? null;
      const errAt = p?.lastSciErrorAt?.getTime() ?? null;
      lanes.push({
        terminalId: t.id,
        name: t.name,
        ipAddress: t.ipAddress,
        pairing: p
          ? {
              id: p.id,
              nickname: p.pairingNickname,
              terminalNickname: p.terminalNickname,
              tid: p.tid,
              active: p.active,
              lastTestAt: p.lastTestAt,
              lastTestOk: p.lastTestOk,
              lastError: p.lastError,
            }
          : null,
        lastSciOkAt: p?.lastSciOkAt ?? null,
        lastSciErrorAt: p?.lastSciErrorAt ?? null,
        lastSciErrorCode: p?.lastSciErrorCode ?? null,
        sciReachable: p == null ? null : okAt == null && errAt == null ? null : (okAt ?? 0) >= (errAt ?? 0),
        lastTransaction: last
          ? {
              id: last.id,
              status: last.status,
              financialStatus: last.financialStatus,
              errorClass: last.errorClass,
              errorCode: last.errorCode,
              amountCents: last.requestedCents,
              at: last.updatedAt,
            }
          : null,
      });
    }
    return {
      serverTime: new Date(this.now()).toISOString(), // A-6: clock skew is visible here
      configured: { pairing: missingPairingConfig(this.cfg).length === 0, signing: missingSigningConfig(this.cfg).length === 0 },
      activeLoops: this.loops.size,
      lanes,
    };
  }
}

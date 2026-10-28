// EFT engine (retail-eftpos S-3 §1–§6): provider-neutral state machine, the
// server-side SCI poll loop per transaction, lane long-poll reads, Action
// Framework relay, override, boot recovery, pairing management and the
// append-only event log. Tills / Runner reach it only through eft.router.ts;
// every secret (pairing API key, signing secret parts, key_id, base URL) stays
// in this process.
//
// State machine (our status):
//   CREATING → PENDING → AWAITING_POS → FINALISED (financialStatus set)
//   CREATING → FAILED   only on a *certain* refusal (4xx answer, no pairing):
//                       nothing was charged, a retry may create a new attempt
//   CREATING → TIMEOUT  [NET|POS] CREATE_UNKNOWN when the create's outcome is
//                       unknown (no answer / timeout / 5xx / server restart)
//   PENDING  → TIMEOUT  [TIMEOUT] DEADLINE (no new SCI version for pollDeadlineMs;
//                       the timer aborts an in-flight long poll)
//   TIMEOUT | FINALISED+UNKNOWN → FINALISED_BY_OVERRIDE | CANCELLED_BY_OVERRIDE
// Every status write goes through transition(): under the row lock, against
// the current status/version; an overridden row never changes again (A-19).
// While TIMEOUT (no override answered yet) the loop keeps watching for
// lateWatchMs and a FINALISED answer still applies; after an override a late
// answer is only logged (LATE_RESULT) — override YES is final. A retry under
// the same sale is allowed only after a certain failure, a decline or override NO.
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
type LoopHandle = { stop: boolean; wake?: () => void; again?: LoopOpts; abort?: () => void };

const OPEN_STATUSES: TxnStatus[] = ["CREATING", "PENDING", "AWAITING_POS"];
const OVERRIDDEN: TxnStatus[] = ["FINALISED_BY_OVERRIDE", "CANCELLED_BY_OVERRIDE"];
const OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const MAX_CENTS = 10_000_000; // $100,000 — a typo guard, not a business limit

/** Only after a *certain* outcome: FAILED is never used for an unknown one (F-1). */
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
  private readonly actionsInFlight = new Set<string>();
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
    const id = txn.id;
    const prev = this.eventQueue.get(id) ?? Promise.resolve();
    const next: Promise<void> = prev
      .then(async () => {
        let seq = this.seqs.get(id);
        if (seq == null) seq = await this.store.maxEventSeq(id);
        seq += 1;
        this.seqs.set(id, seq);
        await this.store.appendEvent({ ...e, detail, transactionId: id, seq, at: new Date(this.now()) });
      })
      .catch((err) => {
        console.error(`[eft] txn=${id} event write failed: ${err instanceof Error ? err.message : err}`);
      })
      .finally(() => this.settleEvents(id, next));
    this.eventQueue.set(id, next);
    return next;
  }

  /**
   * F-6: drop the per-transaction queue/seq cache as soon as the queue is idle
   * and no poll loop owns the row (signature completion, overrides and other
   * loop-less writes included). The next event re-reads max(seq) from the store.
   */
  private settleEvents(id: string, tail: Promise<void>): void {
    // Only a settled tail is ever removed, so a new chain can never race a pending write's seq.
    if (this.loops.has(id) || this.eventQueue.get(id) !== tail) return;
    this.eventQueue.delete(id);
    this.seqs.delete(id);
  }

  /** Settle every event write queued so far (tests, shutdown). */
  async flushEvents(): Promise<void> {
    for (let i = 0; i < 50 && this.eventQueue.size; i++) {
      await Promise.all([...this.eventQueue.values()]);
      await new Promise((r) => setImmediate(r));
    }
  }

  /** In-process bookkeeping sizes — all 0 when nothing is in flight (F-6). */
  memoryStats() {
    return {
      loops: this.loops.size,
      eventQueues: this.eventQueue.size,
      seqs: this.seqs.size,
      locks: this.locks.size,
      actionsInFlight: this.actionsInFlight.size,
      waiters: this.waiters.size(),
    };
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

  /**
   * The only way a row's state changes (A-19, F-2): under the row lock, re-read
   * it, refuse any change to an overridden row, check the caller's guard against
   * the *current* status/version, then write and log STATE. Returns null when
   * the guard (or the override freeze) refused — the caller decides what that means.
   */
  private transition(
    id: string,
    guard: (cur: TxnRow) => boolean,
    patch: TxnPatch | ((cur: TxnRow) => TxnPatch),
    stateDetail?: Record<string, unknown>,
  ): Promise<TxnRow | null> {
    return this.withLock(`txn:${id}`, () => this.transitionLocked(id, guard, patch, stateDetail));
  }

  private async transitionLocked(
    id: string,
    guard: (cur: TxnRow) => boolean,
    patch: TxnPatch | ((cur: TxnRow) => TxnPatch),
    stateDetail?: Record<string, unknown>,
  ): Promise<TxnRow | null> {
    const cur = await this.store.getTxn(id);
    if (!cur || OVERRIDDEN.includes(cur.status) || !guard(cur)) return null;
    const p = typeof patch === "function" ? patch(cur) : patch;
    const updated = await this.update(id, p);
    if (p.status && p.status !== cur.status) {
      await this.emit(cur, {
        source: "SERVER",
        event: "STATE",
        providerVersion: updated.providerVersion,
        statusBefore: cur.status,
        statusAfter: updated.status,
        errorClass: updated.errorClass,
        errorCode: updated.errorCode,
        detail: stateDetail ?? null,
      });
    }
    return updated;
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

  /** A *certain* failure (nothing was charged): FAILED, retryable under the same sale. */
  private async failTxn(
    row: TxnRow,
    err: { errorClass: EftErrorClass; errorCode: string; message?: string },
    http?: HttpMeta | null,
    guard: (cur: TxnRow) => boolean = (cur) => OPEN_STATUSES.includes(cur.status),
  ): Promise<TxnRow | null> {
    await this.emit(row, { source: "SERVER", event: "ERROR", errorClass: err.errorClass, errorCode: err.errorCode, ...this.httpFields(http), detail: { message: err.message ?? null } });
    return this.transition(row.id, guard, { status: "FAILED", errorClass: err.errorClass, errorCode: err.errorCode, finalisedAt: new Date(this.now()) });
  }

  /**
   * F-1 / amended A-5, A-15: the outcome is unknown (the request may have
   * reached the provider). Never FAILED, never retired: TIMEOUT with override
   * required — YES = paid, NO = not paid (and only then retryable).
   */
  private async unresolved(
    row: TxnRow,
    err: { errorClass: EftErrorClass; errorCode: string; cause?: string; message?: string },
    guard: (cur: TxnRow) => boolean,
    http?: HttpMeta | null,
  ): Promise<TxnRow | null> {
    await this.emit(row, {
      source: "SERVER",
      event: "ERROR",
      errorClass: err.errorClass,
      errorCode: err.errorCode,
      ...this.httpFields(http),
      detail: { cause: err.cause ?? null, message: err.message ?? null, outcome: "unknown — override required" },
    });
    return this.transition(row.id, guard, { status: "TIMEOUT", errorClass: err.errorClass, errorCode: err.errorCode });
  }

  // ── state machine: apply one provider answer ──────────────────────────────

  /**
   * "applied" = the row moved; "stale" = nothing new; "late" = the row is
   * overridden and the answer is only a LATE_RESULT event (the row is never
   * touched, A-19); "ignored" = the row is final/failed or the ids disagree.
   * `reassert`: a recovery GET may put a row we set PENDING locally back to the
   * provider's AWAITING_POS at the same version (lost action, F-3).
   */
  private applyAnswer(
    id: string,
    ans: ProviderTxnAnswer,
    source: "SCI_POLL" | "SCI_CREATE" | "SCI_ACTION",
    opts: { reassert?: boolean } = {},
  ): Promise<"applied" | "stale" | "late" | "ignored"> {
    return this.withLock(`txn:${id}`, async () => {
      const row = await this.store.getTxn(id);
      if (!row) return "ignored";
      if (row.providerTxnId && row.providerTxnId !== ans.providerTxnId) {
        await this.emit(row, { source: "SERVER", event: "ERROR", errorClass: "POS", errorCode: "PROVIDER_ID_MISMATCH" });
        return "ignored";
      }
      if (OVERRIDDEN.includes(row.status)) {
        if (ans.status === "FINALISED") {
          await this.emit(row, {
            source: "SCI",
            event: "LATE_RESULT",
            providerVersion: ans.providerVersion,
            detail: { financialStatus: ans.financialStatus, overrideAnswer: row.overrideAnswer, message: ans.message, via: source },
          });
        }
        return "late";
      }
      if (row.status === "FAILED" || (row.status === "FINALISED" && row.financialStatus !== "UNKNOWN")) return "ignored";
      const sameVersion = row.providerVersion != null && ans.providerVersion === row.providerVersion;
      const reassert = opts.reassert && sameVersion && row.status === "PENDING" && ans.status === "AWAITING_POS";
      if (row.providerVersion != null && ans.providerVersion <= row.providerVersion && !reassert) return "stale";

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
      const updated = await this.transitionLocked(id, () => true, patch, {
        financialStatus: patch.financialStatus ?? null,
        message: ans.message,
        via: reassert ? "RECOVERY_REASSERT" : source,
      });
      if (!updated) return "ignored";
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
      if (!reassert) {
        for (const action of ans.posInstructions?.auto_actions ?? []) {
          await this.emit(row, { source: "SCI", event: "AUTO_ACTION", providerVersion: ans.providerVersion, detail: { action } });
        }
      }
      return "applied";
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
        // We cannot know what reached the provider: unresolved, never FAILED (F-1).
        if (row && OPEN_STATUSES.includes(row.status)) {
          await this.unresolved(row, { errorClass: "POS", errorCode: "LOOP_CRASH", message: err instanceof Error ? err.message : String(err) }, (cur) => OPEN_STATUSES.includes(cur.status)).catch(() => undefined);
        }
      })
      .finally(() => {
        this.loops.delete(id);
        this.loopDone.delete(id);
        if (handle.again && !handle.stop && !this.stopped) {
          this.startLoop(id, handle.again);
          return;
        }
        const tail = this.eventQueue.get(id);
        if (tail) void tail.then(() => this.settleEvents(id, tail));
        else this.seqs.delete(id);
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
    const isCreating = (cur: TxnRow) => cur.status === "CREATING" && !cur.providerTxnId;
    if (!pairing) {
      if (opts.fresh) await this.failTxn(row, { errorClass: "PAIR", errorCode: "PAIRING_MISSING" }, null, isCreating);
      return;
    }
    let creds: PairingCredentials;
    try {
      creds = this.creds(pairing);
    } catch {
      if (opts.fresh) await this.failTxn(row, { errorClass: "POS", errorCode: "SECRET_UNREADABLE", message: "part B could not be decrypted with EFT_SECRET_KEY" }, null, isCreating);
      return;
    }
    const provider = this.deps.providerFor(row.provider);

    if (row.status === "CREATING") {
      if (!opts.fresh) return;
      await this.emit(row, { source: "SERVER", event: "SCI_CREATE_REQ", httpMethod: "POST", httpPath: "/v1/transactions", detail: { kind: row.kind, amountCents: row.requestedCents, surchargeCents: row.surchargeCents } });
      const res = await provider.createTransaction(creds, { kind: row.kind, amountCents: row.requestedCents, surchargeCents: row.surchargeCents });
      await this.notePairing(pairing, res.ok ? { ok: true } : { ok: false, error: res.error });
      if (!res.ok) {
        await this.emit(row, { source: "SCI", event: "SCI_CREATE_RES", ...this.httpFields(res.http), errorClass: res.error.errorClass, errorCode: res.error.errorCode, detail: res.error.detail });
        if (res.error.ambiguous) {
          // F-1: may have been charged — the cashier checks the terminal and answers.
          await this.unresolved(row, { errorClass: res.error.errorClass === "POS" ? "POS" : "NET", errorCode: "CREATE_UNKNOWN", cause: res.error.errorCode, message: res.error.message }, isCreating, res.http);
        } else {
          await this.failTxn(row, res.error, res.http, isCreating);
        }
        return;
      }
      await this.emit(row, { source: "SCI", event: "SCI_CREATE_RES", ...this.httpFields(res.http), providerVersion: res.value.providerVersion, detail: { status: res.value.status, message: res.value.message } });
      await this.applyAnswer(id, res.value, "SCI_CREATE");
    }

    let lastProgress = this.now();
    let lateSince: number | null = null;
    // F-9: recovery mode (GET without min_version, may re-show an unchanged
    // AWAITING_POS form) lasts until a valid answer arrives, not just one attempt.
    let recovering = !!opts.recovery;
    let seenVersion: number | null = null; // provider versions seen but not applied (overridden rows)
    while (!handle.stop && !this.stopped) {
      row = await this.store.getTxn(id);
      if (!row) return;
      if (row.status === "FINALISED" || row.status === "FAILED" || row.status === "CREATING") return;
      if (row.status === "AWAITING_POS" && !recovering) return; // paused until an action relay
      if (!row.providerTxnId) return; // CREATE_UNKNOWN: nothing to poll, the override decides
      const late = row.status === "TIMEOUT" || OVERRIDDEN.includes(row.status);
      let remaining: number;
      if (late) {
        lateSince ??= this.now();
        remaining = this.cfg.lateWatchMs - (this.now() - lateSince);
        if (remaining <= 0) return;
      } else {
        remaining = this.cfg.pollDeadlineMs - (this.now() - lastProgress);
        if (remaining <= 0) {
          // A recovering AWAITING_POS row (no answer since restart / lost action) times out too.
          const wasRecovering = recovering;
          const timedOut = await this.transition(
            id,
            (cur) => cur.status === "PENDING" || (wasRecovering && cur.status === "AWAITING_POS"),
            { status: "TIMEOUT", errorClass: "TIMEOUT", errorCode: "DEADLINE" },
          );
          if (!timedOut) continue; // moved on meanwhile — re-evaluated at the top
          await this.emit(row, { source: "SERVER", event: "DEADLINE", errorClass: "TIMEOUT", errorCode: "DEADLINE", detail: { deadlineMs: this.cfg.pollDeadlineMs } });
          recovering = false;
          lateSince = this.now();
          continue;
        }
      }

      const known = Math.max(row.providerVersion ?? 0, seenVersion ?? 0);
      const minVersion = recovering ? undefined : known + 1;
      const reassert = recovering;
      // F-5: the deadline runs independently of the in-flight long poll.
      const ac = new AbortController();
      const deadlineTimer = setTimeout(() => ac.abort(), remaining);
      handle.abort = () => ac.abort();
      await this.emit(row, { source: "SERVER", event: "SCI_POLL_REQ", httpMethod: "GET", httpPath: "/v1/transactions/{id}", detail: { minVersion: minVersion ?? null } });
      const res = await provider.pollTransaction(creds, row.providerTxnId, minVersion, ac.signal);
      clearTimeout(deadlineTimer);
      handle.abort = undefined;
      if (handle.stop || this.stopped) return;
      if (ac.signal.aborted) continue; // deadline/late window reached mid-poll → re-evaluated at the top
      if (res.ok && res.value.kind === "not_yet") {
        await this.emit(row, { source: "SCI", event: "SCI_POLL_TIMEOUT_404", ...this.httpFields(res.http) });
        await this.notePairing(pairing, { ok: true });
        continue;
      }
      if (res.ok && res.value.kind === "answer") {
        const a = res.value.answer;
        await this.emit(row, { source: "SCI", event: "SCI_POLL_RES", ...this.httpFields(res.http), providerVersion: a.providerVersion, detail: { status: a.status, financialStatus: a.financialStatus, message: a.message } });
        await this.notePairing(pairing, { ok: true });
        const outcome = await this.applyAnswer(id, a, "SCI_POLL", { reassert });
        recovering = false;
        if (outcome === "applied") lastProgress = this.now();
        seenVersion = Math.max(seenVersion ?? 0, a.providerVersion);
        if (outcome === "late" && a.status === "FINALISED") return;
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
      let retired: TxnRow | null = null;
      if (existing) {
        if (!isRetryable(existing)) {
          // In flight, approved, or unresolved (TIMEOUT / UNKNOWN — answer the
          // override first): the same row, never a second charge.
          if (existing.requestedCents !== amountCents || existing.surchargeCents !== surchargeCents)
            throw laneError(409, "This sale already has a card payment for a different amount", "POS", "AMOUNT_MISMATCH");
          if (existing.status === "PENDING") this.startLoop(existing.id); // no-op when already running
          return { created: false, txn: laneView(existing) };
        }
        // A new attempt after a *certain* failure / decline / override NO: retire the old key.
        retired = await this.withLock(`txn:${existing.id}`, async () => {
          const cur = await this.store.getTxn(existing.id);
          if (!cur || !isRetryable(cur) || cur.operationId !== operationId) return null;
          return this.update(existing.id, { operationId: `${operationId}#${existing.id}`, retiredAt: new Date(this.now()) }, false);
        });
        if (!retired) {
          const cur = await this.store.findTxnByOperation(operationId, kind);
          if (cur) return { created: false, txn: laneView(cur) };
        }
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
        detail: { kind, amountCents, surchargeCents, operationId, userId: lane.userId, retries: retired?.id ?? null },
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
    const expectVersion = b.version;
    if (expectVersion != null && !Number.isInteger(expectVersion)) throw new HttpException(400, "version must be an integer");

    const row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    if (row.status !== "AWAITING_POS") throw laneError(409, "No action is waiting on this payment", "POS", "NOT_AWAITING_POS");
    if (expectVersion != null && expectVersion !== row.version) throw laneError(409, "The payment changed — showing the latest state", "POS", "STALE_VERSION");
    const prop = posInstructionsOf(row)?.action_form?.properties?.[buttonKey];
    if (!prop || prop.type !== "button") throw new HttpException(400, `unknown button ${buttonKey}`);
    if (this.actionsInFlight.has(id)) throw laneError(409, "An action is already being processed for this payment", "POS", "ACTION_IN_FLIGHT");
    this.actionsInFlight.add(id);
    try {
      return await this.runAction(row, prop, buttonKey, inputs, userId);
    } finally {
      this.actionsInFlight.delete(id);
    }
  }

  private async runAction(
    row: TxnRow,
    prop: NonNullable<ActionForm["properties"]>[string],
    buttonKey: string,
    inputs: Record<string, string>,
    userId: number | null,
  ): Promise<LaneTxnView> {
    const id = row.id;
    // Every transition below re-checks, under the lock, that the row is still the
    // AWAITING_POS step this action was pressed on (A-19, F-2).
    const stillThisStep = (cur: TxnRow) => cur.status === "AWAITING_POS" && cur.providerVersion === row.providerVersion;
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
        // F-3: we cannot tell whether the action landed. Resume the poll loop with
        // a recovery GET under the deadline: a landed action shows up as a new
        // version; one that did not land re-shows the same form (AWAITING_POS).
        const resumed = await this.transition(id, stillThisStep, { status: "PENDING", message: "Checking the terminal…" }, { via: "ACTION_UNCERTAIN" });
        if (resumed) this.startLoop(id, { recovery: true });
        throw laneError(502, "The action may not have reached the payment service — checking the terminal", res.error.errorClass, res.error.errorCode);
      }
      await this.emit(row, { source: "SCI", event: "SCI_ACTION_RES", ...this.httpFields(res.http), providerVersion: res.value?.providerVersion ?? null });
      if (res.value) await this.applyAnswer(id, res.value, "SCI_ACTION");
      // No new answer came back: resume polling for the next version.
      await this.transition(id, stillThisStep, { status: "PENDING", message: "Processing…" }, { via: "ACTION_SENT" });
      const cur = await this.store.getTxn(id);
      if (cur && cur.status === "PENDING") this.startLoop(id);
      return laneView(cur ?? row);
    }

    const changed = (() => {
      switch (prop.action) {
        case "PRINT_MERCHANT_RECEIPT":
          return this.transition(id, stillThisStep, (cur) => ({ merchantPrintSeq: cur.merchantPrintSeq + 1 }));
        case "PRINT_CUSTOMER_RECEIPT":
          return this.transition(id, stillThisStep, (cur) => ({ customerPrintSeq: cur.customerPrintSeq + 1 }));
        case "TRANSACTION_COMPLETE":
          // The POS acknowledged; read the transaction's current state again.
          return this.transition(id, stillThisStep, { status: "PENDING" }, { via: "TRANSACTION_COMPLETE" });
        case "RETRY_TRANSACTION":
          return this.failTxn(row, { errorClass: "TERM", errorCode: "RETRY_REQUESTED", message: "terminal asked the POS to retry" }, null, stillThisStep);
        case "TEST_ACTION":
          return this.transition(id, stillThisStep, {});
        default:
          return null;
      }
    })();
    if (changed === null) throw new HttpException(400, `action ${String(prop.action)} is not supported for a payment`);
    const updated = await changed;
    if (!updated) throw laneError(409, "The payment changed — showing the latest state", "POS", "STALE_STATE");
    if (prop.action === "TRANSACTION_COMPLETE") this.startLoop(id, { recovery: true });
    return laneView(updated);
  }

  async override(id: string, body: unknown, userId: number | null): Promise<LaneTxnView> {
    const answer = (body as Record<string, unknown> | null)?.answer;
    if (answer !== "YES" && answer !== "NO") throw new HttpException(400, 'answer must be "YES" or "NO"');
    const row = await this.store.getTxn(id);
    if (!row) throw new HttpException(404, "EFT transaction not found");
    const status = answer === "YES" ? "FINALISED_BY_OVERRIDE" : "CANCELLED_BY_OVERRIDE";
    const at = new Date(this.now());
    const updated = await this.transition(id, overrideRequired, { status, overrideAnswer: answer, overrideBy: userId, overrideAt: at, finalisedAt: at }, { answer, userId });
    if (!updated) throw laneError(409, "This payment does not need a manual answer", "POS", "OVERRIDE_NOT_ALLOWED");
    await this.emit(row, { source: "TERMINAL_OP", event: "OVERRIDE", detail: { answer, userId } });
    return laneView(updated);
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
    const updated = await this.transition(id, (cur) => OPEN_STATUSES.includes(cur.status), { cancelRequestedAt: new Date(this.now()) });
    if (!updated) throw laneError(409, "This payment has already finished", "POS", "NOT_OPEN");
    return laneView(updated);
  }

  // ── boot recovery (S-3 §4, amended A-5) ───────────────────────────────────

  async recover(): Promise<{ resumed: number; unresolved: number }> {
    const rows = await this.store.listTxnsByStatus([...OPEN_STATUSES, "TIMEOUT"]);
    let resumed = 0;
    let unresolved = 0;
    for (const row of rows) {
      if (this.loops.has(row.id)) continue;
      if (row.status === "TIMEOUT") {
        // Unresolved before the restart: keep watching for a late answer (no
        // upstream id → nothing to poll; the override decides).
        if (row.providerTxnId && !row.overrideAnswer) {
          await this.emit(row, { source: "SERVER", event: "RECOVERY_RESUME", detail: { status: row.status, providerVersion: row.providerVersion } });
          this.startLoop(row.id, { recovery: true });
          resumed++;
        }
        continue;
      }
      if (row.status === "CREATING" && !row.providerTxnId) {
        // The create may or may not have reached the provider: unresolved, like TIMEOUT.
        await this.emit(row, { source: "SERVER", event: "RECOVERY_RESUME", detail: { status: row.status, outcome: "create outcome unknown" } });
        await this.unresolved(row, { errorClass: "POS", errorCode: "CREATE_UNKNOWN", cause: "SERVER_RESTART", message: "server stopped while the create was in flight" }, (cur) => cur.status === "CREATING" && !cur.providerTxnId);
        unresolved++;
        continue;
      }
      if (row.status === "CREATING") await this.transition(row.id, (cur) => cur.status === "CREATING", { status: "PENDING" });
      await this.emit(row, { source: "SERVER", event: "RECOVERY_RESUME", detail: { status: row.status, providerVersion: row.providerVersion } });
      this.startLoop(row.id, { recovery: true });
      resumed++;
    }
    if (rows.length) this.log(`[eft] recovery: resumed=${resumed} unresolved=${unresolved}`);
    return { resumed, unresolved };
  }

  /** Stop every loop (shutdown / tests), abort in-flight polls, wait for them to exit. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const h of this.loops.values()) {
      h.stop = true;
      h.wake?.();
      h.abort?.();
    }
    await Promise.all([...this.loopDone.values()]);
    await this.flushEvents();
  }

  /** Wait until no loop is running and every event is written (tests). */
  async idle(): Promise<void> {
    while (this.loopDone.size) await Promise.all([...this.loopDone.values()]);
    await this.flushEvents();
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

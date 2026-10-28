// Integrated CREDIT tender — the till side of one card payment (retail-eftpos
// T-7, D-2..D-5). Pure: no React, no axios, no window — the PaymentModal's
// EftPanel drives it through useEftTender, node tests drive it with fakes.
//
//   till ──POST /api/eft/transactions {operationId, PURCHASE, amountCents, 0}──▶ store server
//   till ◀──GET /api/eft/transactions/:id?min_version=N (held ≤ 20 s)────────── store server
//
// D-4: long polling only. The loop asks for `version + 1` after every answer,
// whatever it was (a hold expiry answers 200 with the same version; an error
// keeps the loop going). Payment state never comes over socket.io.
// The server drives the terminal on its own: the till only reads, renders and
// relays the cashier's buttons. Rules from the lane contract
// (retail_pos_server/AGENTS.md "Integrated EFTPOS"):
//   - `overrideRequired` (also straight after a create whose outcome is
//     unknown) → "Was the transaction successful?" Yes / No;
//   - a 502 on an action → keep polling (the server is already re-checking
//     the terminal); 409 STALE_VERSION → re-read and re-render;
//   - `final` → stop; FINALISED APPROVED → the tender is the server's
//     `resultAmounts` total (never the keyed amount); FINALISED_BY_OVERRIDE
//     (cashier said Yes) → the keyed amount; anything else final → not paid,
//     back to the pay panel with `displayMessage`.
// Error text is the server's `displayMessage` / `msg` verbatim (it carries
// the `[CLASS]`); only a till that cannot reach the store server says
// STORE_UNREACHABLE.

import type { EftActionForm, EftAnswer, EftPairing, EftTxn } from "./eft-types";

export const STORE_UNREACHABLE = "Store server unreachable [NET]";
export const OVERRIDE_QUESTION = "Was the transaction successful?";
export const EFT_NOT_CONFIGURED = "EFT is not configured";
export const ALREADY_APPLIED = "This card payment is already in the payments list [POS]";

// "review" (A-27, F-11/F-15): the terminal approved, but its result is not
// exactly the requested purchase (another purchase amount, a surcharge / tip /
// cashout added on the terminal, or no purchase amount at all). Nothing is
// committed; the cashier sees the breakdown and handles it manually.
export type EftOutcome =
  | { kind: "paid"; txnId: string; amountCents: number; viaOverride: boolean }
  | { kind: "review"; txnId: string; message: string }
  | { kind: "not-paid"; txnId: string | null; message: string };

export interface EftFlowState {
  /** idle → starting (create in flight) → live (polling) → done (outcome set). */
  phase: "idle" | "starting" | "live" | "done";
  requestCents: number;
  txn: EftTxn | null;
  /** A transient line under the status (a poll / action error); cleared by a newer version. */
  notice: string | null;
  /** An action / override / cancel request is in flight. */
  busy: boolean;
  outcome: EftOutcome | null;
  /** 503 "EFT is not configured": the lane falls back to the keyed CREDIT. */
  unavailable: boolean;
}

export type EftFlowEvent =
  | { type: "start"; requestCents: number }
  | { type: "create-answer"; res: EftAnswer<EftTxn>; appliedTxnIds?: readonly string[] }
  | { type: "poll-answer"; res: EftAnswer<EftTxn> }
  | { type: "request-sent" }
  | { type: "request-answer"; res: EftAnswer<EftTxn> }
  | { type: "reset" };

export function initialEftFlow(): EftFlowState {
  return { phase: "idle", requestCents: 0, txn: null, notice: null, busy: false, outcome: null, unavailable: false };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const EXTRA_KEYS = ["surcharge", "tip", "cashout"] as const;
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * A-27: the CREDIT tender an APPROVED answer stands for = the result's
 * `purchase` component, and only when it equals the requested amount with no
 * surcharge / tip / cashout added on the terminal. Otherwise `ok: false` with
 * the breakdown text for the cashier (F-11, F-15: a missing `purchase` is
 * never replaced by the requested amount).
 */
export function approvedTender(
  txn: Pick<EftTxn, "resultAmounts" | "amountCents">,
): { ok: true; amountCents: number } | { ok: false; message: string } {
  const ra = txn.resultAmounts ?? null;
  const purchase = ra?.purchase;
  const extras = EXTRA_KEYS.map((k) => [k, ra?.[k]] as const).filter(([, v]) => v != null && v !== 0);
  const extrasValid = extras.every(([, v]) => isCents(v));
  if (isCents(purchase) && purchase > 0 && purchase === txn.amountCents && extras.length === 0)
    return { ok: true, amountCents: purchase };
  if (!isCents(purchase) || purchase <= 0 || !extrasValid)
    return {
      ok: false,
      message: `Approved — the terminal sent no valid purchase amount (requested ${money(txn.amountCents)}); differs from the sale`,
    };
  const total = purchase + extras.reduce((n, [, v]) => n + (v as number), 0);
  const parts = [`purchase ${money(purchase)}`, ...extras.map(([k, v]) => `${k} ${money(v as number)}`)];
  return { ok: false, message: `Approved ${money(total)} — ${parts.join(", ")}; differs from the sale` };
}

/** Final outcome of a transaction view, or null while it is still open. */
export function outcomeOf(txn: EftTxn): EftOutcome | null {
  if (txn.status === "FINALISED_BY_OVERRIDE")
    return { kind: "paid", txnId: txn.id, amountCents: txn.amountCents, viaOverride: true };
  if (txn.status === "FINALISED" && txn.financialStatus === "APPROVED") {
    const t = approvedTender(txn);
    return t.ok
      ? { kind: "paid", txnId: txn.id, amountCents: t.amountCents, viaOverride: false }
      : { kind: "review", txnId: txn.id, message: t.message };
  }
  if (txn.final) return { kind: "not-paid", txnId: txn.id, message: txn.displayMessage };
  return null;
}

/**
 * A lane API error as the cashier sees it: the server's text verbatim — lane
 * errors already end in their `[CLASS]`. A message without one gets the
 * class the server put in `result.errorClass`, else [PAIR] for 503 (EFT not
 * configured on the store server) and [POS] for anything else, so every
 * error line carries a short code (D-5).
 */
export function eftErrorText(res: EftAnswer<unknown>): string {
  if (res.status === 0) return STORE_UNREACHABLE;
  const msg = res.msg || `Request failed (${res.status})`;
  if (/\[[A-Z]+\]$/.test(msg)) return msg;
  const r = res.result;
  const cls =
    r && typeof r === "object" && typeof (r as { errorClass?: unknown }).errorClass === "string"
      ? (r as { errorClass: string }).errorClass
      : res.status === 503
        ? "PAIR"
        : "POS";
  return `${msg} [${cls}]`;
}
const errorText = eftErrorText;

/** A newer (or the first) view of the row replaces the shown one; an older one is ignored. */
function applyTxn(state: EftFlowState, txn: EftTxn): EftFlowState {
  const cur = state.txn;
  if (cur && cur.id === txn.id && txn.version < cur.version) return state;
  const advanced = !cur || cur.id !== txn.id || txn.version > cur.version;
  const outcome = outcomeOf(txn);
  return {
    ...state,
    txn,
    notice: advanced ? null : state.notice,
    phase: outcome ? "done" : "live",
    outcome,
  };
}

export function eftFlowReducer(state: EftFlowState, ev: EftFlowEvent): EftFlowState {
  switch (ev.type) {
    case "start":
      return { ...initialEftFlow(), phase: "starting", requestCents: ev.requestCents };
    case "reset":
      return initialEftFlow();
    case "create-answer": {
      if (state.phase !== "starting") return state;
      const res = ev.res;
      if (res.ok && res.result) {
        // The same sale attempt answers the same row (no double charge). A row
        // already applied to this payment list is never applied twice.
        // (txn left null: its receipts already printed when it was applied.)
        if (ev.appliedTxnIds?.includes(res.result.id))
          return { ...state, phase: "done", outcome: { kind: "not-paid", txnId: res.result.id, message: ALREADY_APPLIED } };
        return applyTxn(state, res.result);
      }
      const unavailable = res.status === 503 && res.msg === EFT_NOT_CONFIGURED;
      return {
        ...state,
        phase: "done",
        unavailable,
        outcome: { kind: "not-paid", txnId: null, message: errorText(res) },
      };
    }
    case "poll-answer": {
      if (state.phase !== "live") return state;
      if (ev.res.ok && ev.res.result) return applyTxn(state, ev.res.result);
      // 404: the row is gone (never on a hold expiry) — stop instead of re-polling forever.
      if (ev.res.status === 404)
        return { ...state, phase: "done", outcome: { kind: "not-paid", txnId: state.txn?.id ?? null, message: errorText(ev.res) } };
      return { ...state, notice: errorText(ev.res) };
    }
    case "request-sent":
      return state.phase === "live" ? { ...state, busy: true, notice: null } : state;
    case "request-answer": {
      if (state.phase !== "live") return { ...state, busy: false };
      const next = { ...state, busy: false };
      if (ev.res.ok && ev.res.result) return applyTxn(next, ev.res.result);
      // 502 (the action may not have landed — the server is re-checking the
      // terminal), 409 STALE_VERSION / STALE_STATE / OVERRIDE_NOT_ALLOWED, or
      // no answer: show it and keep polling; the driver re-reads at once.
      return { ...next, notice: errorText(ev.res) };
    }
  }
}

/** The loop's next `min_version` (last seen + 1), or null when it must stop. */
export function nextMinVersion(state: EftFlowState): number | null {
  if (state.phase !== "live" || !state.txn) return null;
  return state.txn.version + 1;
}

/** What the EFT panel shows. */
export function eftPanelView(state: EftFlowState) {
  const txn = state.txn;
  const open = state.phase === "live" && !!txn;
  const status = txn?.status ?? null;
  return {
    message:
      state.phase === "starting"
        ? "Sending to terminal…"
        : state.outcome && state.outcome.kind !== "paid"
          ? state.outcome.message
          : txn?.displayMessage ?? "",
    notice: state.notice,
    showOverride: open && !!txn?.overrideRequired,
    actionForm: open && status === "AWAITING_POS" ? (txn?.actionForm ?? null) : null,
    canCancel:
      open && !txn?.cancelRequested && (status === "CREATING" || status === "PENDING" || status === "AWAITING_POS"),
    cancelRequested: !!txn?.cancelRequested,
    busy: state.busy,
  };
}

// ── receipts (D-3 / certification: both receipts printed, declined too) ──────

// F-16: marks are per transaction and never keyed on the lane version — a
// local version bump (Cancel on a signature prompt, an action relay) with the
// same print seqs and the same receipt text prints nothing.
export interface PrintMarks {
  txnId: string | null;
  merchantSeq: number;
  customerSeq: number;
  /** Merchant receipt text already printed for a PRINT_MERCHANT_RECEIPT auto action. */
  autoPrinted: string | null;
  finalPrinted: boolean;
}

export const initialPrintMarks = (): PrintMarks => ({
  txnId: null,
  merchantSeq: 0,
  customerSeq: 0,
  autoPrinted: null,
  finalPrinted: false,
});

export interface ReceiptJob {
  which: "merchant" | "customer";
  text: string;
}

/**
 * Receipts due for this view: when `merchantPrintSeq` / `customerPrintSeq`
 * grew, when `autoActions` asks for PRINT_MERCHANT_RECEIPT (once per distinct
 * merchant receipt of the transaction), and both receipts once the
 * transaction is FINALISED.
 */
export function receiptJobs(prev: PrintMarks, txn: EftTxn): { jobs: ReceiptJob[]; marks: PrintMarks } {
  let merchant = false;
  let customer = false;
  const marks = prev.txnId === txn.id ? prev : { ...initialPrintMarks(), txnId: txn.id };
  const next: PrintMarks = { ...marks };
  if (txn.merchantPrintSeq > marks.merchantSeq) {
    merchant = true;
    next.merchantSeq = txn.merchantPrintSeq;
  }
  if (txn.customerPrintSeq > marks.customerSeq) {
    customer = true;
    next.customerSeq = txn.customerPrintSeq;
  }
  if (
    txn.autoActions.includes("PRINT_MERCHANT_RECEIPT") &&
    txn.merchantReceipt &&
    marks.autoPrinted !== txn.merchantReceipt
  ) {
    merchant = true;
    next.autoPrinted = txn.merchantReceipt;
  }
  if (txn.status === "FINALISED" && !marks.finalPrinted) {
    merchant = true;
    customer = true;
    next.finalPrinted = true;
  }
  const jobs: ReceiptJob[] = [];
  if (merchant && txn.merchantReceipt) jobs.push({ which: "merchant", text: txn.merchantReceipt });
  if (customer && txn.customerReceipt) jobs.push({ which: "customer", text: txn.customerReceipt });
  return { jobs, marks: next };
}

// ── the loop driver (React-free; useEftTender owns one per EFT panel) ────────

/** Every call takes the session's AbortSignal: stop() aborts what is in flight (F-17). */
export interface EftLaneApi {
  create(
    body: { operationId: string; kind: "PURCHASE"; amountCents: number; surchargeCents: number },
    signal?: AbortSignal,
  ): Promise<EftAnswer<EftTxn>>;
  get(id: string, minVersion: number | null, signal?: AbortSignal): Promise<EftAnswer<EftTxn>>;
  action(
    id: string,
    body: { buttonKey: string; inputs: Record<string, string>; version: number },
    signal?: AbortSignal,
  ): Promise<EftAnswer<EftTxn>>;
  override(id: string, answer: "YES" | "NO", signal?: AbortSignal): Promise<EftAnswer<EftTxn>>;
  cancel(id: string, signal?: AbortSignal): Promise<EftAnswer<EftTxn>>;
}

export interface EftSessionDeps {
  api: EftLaneApi;
  onState: (state: EftFlowState) => void;
  print?: (job: ReceiptJob) => Promise<void>;
  /** Pause after a failed poll before the next one (no hot loop when the server is down). */
  retryDelayMs?: number;
  /** Must resolve early when `signal` aborts (the default does and clears its timer). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * One card payment: create, then long-poll until `final` or `stop()`. Each
 * answer goes through eftFlowReducer; receipts go out through `print` (a
 * failed print never stops the payment). Buttons, override and cancel are
 * relayed with the row's current `version`, and any refused / lost one is
 * followed by an immediate read (no min_version) so the panel re-renders the
 * server's current state.
 */
export function createEftSession(deps: EftSessionDeps) {
  const sleep = deps.sleep ?? abortableSleep;
  const retryDelayMs = deps.retryDelayMs ?? 1000;
  const abort = new AbortController();
  const signal = abort.signal;
  let state = initialEftFlow();
  let marks = initialPrintMarks();
  let stopped = false;
  let printChain: Promise<void> = Promise.resolve();

  const dispatch = (ev: EftFlowEvent) => {
    if (stopped) return;
    const before = state;
    state = eftFlowReducer(state, ev);
    if (state.txn && state.txn !== before.txn) {
      const r = receiptJobs(marks, state.txn);
      marks = r.marks;
      for (const job of r.jobs) {
        const print = deps.print;
        if (print) printChain = printChain.then(() => print(job)).catch(() => undefined);
      }
    }
    if (state !== before) deps.onState(state);
  };

  async function loop(): Promise<void> {
    for (;;) {
      if (stopped) return;
      const minVersion = nextMinVersion(state);
      const txn = state.txn;
      if (minVersion == null || !txn) return;
      const res = await deps.api.get(txn.id, minVersion, signal);
      if (stopped) return;
      dispatch({ type: "poll-answer", res });
      if (!res.ok) await sleep(retryDelayMs, signal);
    }
  }

  async function relay(send: (signal: AbortSignal) => Promise<EftAnswer<EftTxn>>): Promise<void> {
    if (stopped || state.phase !== "live" || state.busy) return;
    dispatch({ type: "request-sent" });
    const res = await send(signal);
    if (stopped) return;
    dispatch({ type: "request-answer", res });
    if (!res.ok && state.txn && state.phase === "live") {
      const now = await deps.api.get(state.txn.id, null, signal);
      if (stopped) return;
      dispatch({ type: "poll-answer", res: now });
    }
  }

  return {
    getState: () => state,
    async start(input: { operationId: string; amountCents: number; appliedTxnIds?: readonly string[] }): Promise<void> {
      dispatch({ type: "start", requestCents: input.amountCents });
      if (stopped) return;
      const res = await deps.api.create(
        {
          operationId: input.operationId,
          kind: "PURCHASE",
          amountCents: input.amountCents,
          surchargeCents: 0,
        },
        signal,
      );
      if (stopped) return;
      dispatch({ type: "create-answer", res, appliedTxnIds: input.appliedTxnIds });
      await loop();
    },
    /** `body.version` = the version whose form the cashier pressed (409 STALE_VERSION if it moved). */
    pressButton(body: { buttonKey: string; inputs: Record<string, string>; version: number }): Promise<void> {
      const txn = state.txn;
      if (!txn) return Promise.resolve();
      return relay((sig) => deps.api.action(txn.id, body, sig));
    },
    answerOverride(answer: "YES" | "NO"): Promise<void> {
      const txn = state.txn;
      if (!txn) return Promise.resolve();
      return relay((sig) => deps.api.override(txn.id, answer, sig));
    },
    requestCancel(): Promise<void> {
      const txn = state.txn;
      if (!txn) return Promise.resolve();
      return relay((sig) => deps.api.cancel(txn.id, sig));
    },
    /**
     * Leave the payment (panel closed / unmounted). The server keeps going.
     * In-flight requests are aborted and the retry pause ends (F-17).
     */
    stop(): void {
      stopped = true;
      abort.abort();
    },
    /** Settle queued receipt prints (tests). */
    printsSettled: () => printChain,
  };
}

export type EftSession = ReturnType<typeof createEftSession>;

/** Pure helper the panels use for the "form or not" decision. */
export function hasActionForm(form: EftActionForm | null): form is EftActionForm {
  return !!form && !!form.properties && Object.keys(form.properties).length > 0;
}

/**
 * This lane's chosen, active pairing — the CREDIT tender is integrated only
 * then (S-3 A-1). The operator picks the terminal (POST /pairings/:id/select);
 * nothing here ever picks one.
 */
export function activeLanePairing(pairings: readonly EftPairing[] | null | undefined): EftPairing | null {
  return pairings?.find((p) => p.selectedForThisTerminal && p.active) ?? null;
}

/**
 * A pairing's state line on the pairing screen. `lastError` is what the store
 * server recorded: "unpaired" (Unpair here) or `no_active_pairings_found`
 * (unpaired on the terminal / by the payment service — externally unpaired).
 */
export function pairingStateText(p: Pick<EftPairing, "active" | "lastError" | "lastTestOk">): {
  tone: "ok" | "warn" | "off";
  text: string;
} {
  if (p.active) {
    if (p.lastTestOk === false && p.lastError) return { tone: "warn", text: `Paired — last test failed (${p.lastError})` };
    return { tone: "ok", text: "Paired" };
  }
  if (p.lastError === "unpaired") return { tone: "off", text: "Unpaired" };
  if (p.lastError === "no_active_pairings_found")
    return { tone: "warn", text: "Not paired — unpaired on the terminal; pair again [PAIR]" };
  return { tone: "warn", text: p.lastError ? `Not paired (${p.lastError}) [PAIR]` : "Not paired [PAIR]" };
}

// Till-side operation identity (T-15, platform/D-10 — R-3/V-1; review F-4/F-5).
//
// Every checkout / refund / repay ATTEMPT has its own key in localStorage
// (per till), and the key — not the payload — identifies the transaction:
//   sale   "sale:cart:<slot>"            one per cart slot (the till has 4);
//          a SPEND from that slot is the same attempt (T-10)
//   refund "refund:invoice:<originalId>"
//   repay  "repay:invoice:<originalId>"
//   points→voucher exchange "cv-issue:<memberId>" (T-17, V-5) — one pending
//          exchange per member; the chosen tier travels in the attempt's
//          payload {amount} (retail-delivery D-24)
//   Cash In/Out "cashio:form" one per till (T-10; ended by the form's Cancel)
// The attempt's operationId (UUID) is minted on the first submit and resent on
// every retry of that attempt, whatever the payload looks like now, until:
//   - the server answers ok (the attempt is recorded), or
//   - the server answers 409 OPERATION_CANCELLED / OPERATION_PAYLOAD_MISMATCH
//     (the server has settled this id; the next press starts a new attempt), or
//   - the cashier empties that cart by any path (endAttemptsOfEmptiedCarts,
//     F-7); a cart that starts empty (till start) keeps its attempt (F-9).
// There is no time-based expiry: an elapsed time never proves the earlier
// submit failed (F-5). Network errors, timeouts, 5xx, 503 "CRM did not answer"
// and 409 OPERATION_IN_PROGRESS keep the id so the retry replays the same
// attempt. Two carts never share an id (F-4): an identical cart in another
// slot is a different attempt and records its own Invoice.
// Called from service/*.service.ts, the cart store and libs/sale/submit-sale.
// Runner copies it (sale-core, T-1) and injects its own store
// (setOperationStorage).

const STORAGE_PREFIX = "ktpv5.operationAttempt.";
const CLEARING_CODES = new Set(["OPERATION_CANCELLED", "OPERATION_PAYLOAD_MISMATCH"]);

export function saleAttemptKey(cartIndex: number): string {
  return `sale:cart:${cartIndex}`;
}

export function refundAttemptKey(originalInvoiceId: number): string {
  return `refund:invoice:${originalInvoiceId}`;
}

export function repayAttemptKey(originalInvoiceId: number): string {
  return `repay:invoice:${originalInvoiceId}`;
}

// T-17 (V-5) — one points→voucher exchange per member: a retry after a lost
// answer resends the same id and CRM returns the voucher it already issued
// instead of deducting points again. retail-delivery D-24 (review round 1):
// the key stays per member (not per tier) so an unresolved exchange — also one
// left by a till on the previous release — blocks a new one; the chosen
// amount is stored as the attempt's payload and resent on the retry.
export function customerVoucherIssueAttemptKey(memberId: string): string {
  return `cv-issue:${memberId}`;
}

// T-10 (F-27) — the till's Cash In/Out form: one entry at a time. The attempt
// is kept across a lost answer (the retry replays the recorded row) and ends
// on an answer or when the cashier cancels the form.
export function cashIOAttemptKey(): string {
  return "cashio:form";
}

interface StoredAttempt {
  operationId: string;
  createdAt: number;
  // D-24: what the retry must resend (e.g. the exchange amount). Absent on
  // records written before it existed and on attempts minted without one.
  payload?: Record<string, unknown>;
}

// The attempt store — exactly the three calls this module makes. The POS uses
// the till's localStorage (default). A host without localStorage (Runner, React
// Native) injects a persistent store with setOperationStorage; without one,
// every call mints a fresh id and retries lose replay protection.
export interface OperationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injectedStorage: OperationStorage | null = null;

// Install the attempt store; null restores the default (localStorage when
// defined). Calls must be synchronous, like localStorage.
export function setOperationStorage(store: OperationStorage | null): void {
  injectedStorage = store;
}

function storage(): OperationStorage | null {
  if (injectedStorage) return injectedStorage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(attemptKey: string): StoredAttempt | null {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + attemptKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAttempt>;
    if (typeof parsed.operationId !== "string" || parsed.operationId.length < 8) return null;
    const attempt: StoredAttempt = {
      operationId: parsed.operationId,
      createdAt: Number(parsed.createdAt) || 0,
    };
    if (parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)) {
      attempt.payload = parsed.payload;
    }
    return attempt;
  } catch {
    return null;
  }
}

// The attempt still open under this key (minted, not yet settled), without
// minting one — null when there is none (D-24: the exchange modal asks before
// offering a new exchange).
export function pendingOperation(attemptKey: string): StoredAttempt | null {
  return read(attemptKey);
}

// The cashier ended this attempt (cart cleared / new transaction).
export function clearOperation(attemptKey: string): void {
  try {
    storage()?.removeItem(STORAGE_PREFIX + attemptKey);
  } catch {
    // storage unavailable — nothing to clear
  }
}

// F-7 / F-9 — a cart the cashier EMPTIES (Clear, last line removed, qty → 0)
// is a transaction boundary: its attempt ends. A cart that was already empty
// — e.g. every cart right after a till start — is not an abandonment, so a
// persisted attempt survives a restart; the next submit from that slot reuses
// its id and the server answers with the recorded Invoice (replayed) or a 409
// naming it. Called by the cart store with each slot's line count before and
// after every carts change.
export function endAttemptsOfEmptiedCarts(prevLineCounts: number[], lineCounts: number[]): void {
  lineCounts.forEach((count, index) => {
    if (count === 0 && (prevLineCounts[index] ?? 0) > 0) clearOperation(saleAttemptKey(index));
  });
}

// The attempt's operationId: the stored one, or a new one stored before the
// request is sent. `payload` is stored only when a new attempt is minted; an
// existing attempt keeps the payload it was minted with.
export function operationIdFor(
  attemptKey: string,
  now: number = Date.now(),
  payload?: Record<string, unknown>,
): string {
  const stored = read(attemptKey);
  if (stored) return stored.operationId;
  const operationId = crypto.randomUUID();
  const record: StoredAttempt = payload
    ? { operationId, createdAt: now, payload }
    : { operationId, createdAt: now };
  try {
    storage()?.setItem(STORAGE_PREFIX + attemptKey, JSON.stringify(record));
  } catch {
    // storage unavailable — the id still protects retries inside this request
  }
  return operationId;
}

// After an answer: ok or a settling 409 ends the attempt; anything else keeps it.
export function settleOperation(
  attemptKey: string,
  res: { ok: boolean; result?: unknown },
): void {
  if (res.ok) {
    clearOperation(attemptKey);
    return;
  }
  const code =
    res.result && typeof res.result === "object"
      ? (res.result as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" && CLEARING_CODES.has(code)) clearOperation(attemptKey);
}

// One request under an attempt: send with the attempt's id, then settle it by
// the answer (T-17; used by the customer-voucher exchange press).
// `payload` is recorded with a newly minted attempt (D-24: the exchange amount).
export async function sendWithOperation<R extends { ok: boolean; result?: unknown }>(
  attemptKey: string,
  send: (operationId: string) => Promise<R>,
  payload?: Record<string, unknown>,
): Promise<R> {
  const operationId = operationIdFor(attemptKey, Date.now(), payload);
  const res = await send(operationId);
  settleOperation(attemptKey, res);
  return res;
}

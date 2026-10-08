// Till-side operation identity (T-15, platform/D-10 — R-3/V-1; review F-4/F-5).
//
// Every checkout / refund / repay ATTEMPT has its own key in localStorage
// (per till), and the key — not the payload — identifies the transaction:
//   sale   "sale:cart:<slot>"            one per cart slot (the till has 4)
//   refund "refund:invoice:<originalId>"
//   repay  "repay:invoice:<originalId>"
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
// Called only from service/*.service.ts and the cart store. Not a sale-core
// file (Runner does not copy it; Runner sends no operationId and keeps working).

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

interface StoredAttempt {
  operationId: string;
  createdAt: number;
}

function storage(): Storage | null {
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
    return { operationId: parsed.operationId, createdAt: Number(parsed.createdAt) || 0 };
  } catch {
    return null;
  }
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
// request is sent.
export function operationIdFor(attemptKey: string, now: number = Date.now()): string {
  const stored = read(attemptKey);
  if (stored) return stored.operationId;
  const operationId = crypto.randomUUID();
  try {
    storage()?.setItem(
      STORAGE_PREFIX + attemptKey,
      JSON.stringify({ operationId, createdAt: now } satisfies StoredAttempt),
    );
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

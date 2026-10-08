// Till-side operation identity (T-15, platform/D-10 — R-3/V-1).
//
// A checkout / refund / repay attempt gets a UUID `operationId` when it is
// first submitted. It is kept in localStorage (per till) together with a
// fingerprint of the payload until the server answers ok:
//   - a retry of the same cart / refund (same fingerprint) reuses it, so a
//     lost response never creates a second Invoice or CRM debit — the server
//     replays the original invoice (`replayed: true`);
//   - a changed cart gets a new id;
//   - the server's "attempt cancelled" / "payload mismatch" 409s clear it,
//     so the next press starts a new attempt;
//   - it expires after 15 minutes, so an abandoned attempt never captures a
//     later identical sale.
// Called only from service/*.service.ts. Not a sale-core file (Runner does
// not copy it; Runner sends no operationId and keeps working).

export type OperationScope = "sale" | "refund" | "repay";

const STORAGE_PREFIX = "ktpv5.pendingOperation.";
const TTL_MS = 15 * 60 * 1000;
const CLEARING_CODES = new Set(["OPERATION_CANCELLED", "OPERATION_PAYLOAD_MISMATCH"]);

interface StoredOperation {
  operationId: string;
  fingerprint: string;
  createdAt: number;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined && key !== "operationId") out[key] = stable(v);
    }
    return out;
  }
  return value;
}

// cyrb53 — a fast 53-bit string hash; collisions only cost idempotency
// between two different carts inside the TTL, and the server's payload hash
// check turns that into a 409, never a wrong replay.
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function payloadFingerprint(payload: unknown): string {
  return hash53(JSON.stringify(stable(payload)));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(scope: OperationScope): StoredOperation | null {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOperation>;
    if (
      typeof parsed.operationId !== "string" ||
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.createdAt !== "number"
    )
      return null;
    return parsed as StoredOperation;
  } catch {
    return null;
  }
}

export function clearOperation(scope: OperationScope): void {
  try {
    storage()?.removeItem(STORAGE_PREFIX + scope);
  } catch {
    // storage unavailable — nothing to clear
  }
}

// The operationId for this attempt: the stored one when the payload is the
// same and fresh, otherwise a new one (stored before the request is sent).
export function operationIdFor(
  scope: OperationScope,
  payload: unknown,
  now: number = Date.now(),
): string {
  const fingerprint = payloadFingerprint(payload);
  const stored = read(scope);
  if (stored && stored.fingerprint === fingerprint && now - stored.createdAt < TTL_MS)
    return stored.operationId;
  const operationId = crypto.randomUUID();
  try {
    storage()?.setItem(
      STORAGE_PREFIX + scope,
      JSON.stringify({ operationId, fingerprint, createdAt: now } satisfies StoredOperation),
    );
  } catch {
    // storage unavailable — the id still protects retries inside this request
  }
  return operationId;
}

// After the server answered: ok → done; a cancelled / mismatched attempt →
// start fresh next time. Anything else (network error, timeout, 5xx, a CRM
// that did not answer) keeps the id so the retry replays the same attempt.
export function settleOperation(
  scope: OperationScope,
  res: { ok: boolean; result?: unknown },
): void {
  if (res.ok) {
    clearOperation(scope);
    return;
  }
  const code =
    res.result && typeof res.result === "object"
      ? (res.result as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" && CLEARING_CODES.has(code)) clearOperation(scope);
}

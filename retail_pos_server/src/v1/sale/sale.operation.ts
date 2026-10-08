import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, HttpException } from "../../libs/exceptions";

// ══════════════════════════════════════════════════════════════════════════════
// Client operation identity (T-15, platform/D-10 — R-3/V-1)
//
// A till mints `operationId` (UUID) when a checkout / refund / repay attempt
// starts and keeps it until the server answers ok. The server stores it on
// SaleInvoice.operationId (@unique) with a hash of the payload:
//   - same id + same hash  → the original invoice again, `replayed: true`
//   - same id + other hash → 409 OPERATION_PAYLOAD_MISMATCH
//   - no id (old till, Runner) → the server mints one, logs one INFO line, and
//     the request works as before (no idempotency).
// Customer-voucher CRM keys derive from it (`<operationId>:cv:<voucherId>:<amount>`,
// `<operationId>:cv-refund:<n>`), so a retried checkout replays the same CRM
// keys instead of debiting twice.
//
// In-process claims: the store server runs as one PM2 process. A claim keeps
// two requests (or a request and the reconciler) from working the same
// operation at once; the DB unique constraint is the last line of defence.
// ══════════════════════════════════════════════════════════════════════════════

export const OPERATION_CODES = {
  PAYLOAD_MISMATCH: "OPERATION_PAYLOAD_MISMATCH",
  IN_PROGRESS: "OPERATION_IN_PROGRESS",
  CANCELLED: "OPERATION_CANCELLED",
} as const;

// Letters/digits/dash only: no ':' so the "<id>:refund" / "<id>:cv:..." keys
// built from it stay unambiguous.
const OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export function normalizeOperationId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !OPERATION_ID_RE.test(value.trim()))
    throw new BadRequestException(
      "operationId must be 8-64 letters, digits or dashes",
    );
  return value.trim();
}

export type OperationRoute = "sale" | "refund" | "repay";

export function resolveOperationId(
  value: unknown,
  route: OperationRoute,
): { operationId: string; minted: boolean } {
  const given = normalizeOperationId(value);
  if (given) return { operationId: given, minted: false };
  const operationId = randomUUID();
  console.info(
    `[sale-operation] ${route} request without operationId — server minted ${operationId} (no retry idempotency for this request)`,
  );
  return { operationId, minted: true };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = stable(v);
    }
    return out;
  }
  return value;
}

// sha256 over the key-sorted payload without its operationId.
export function operationPayloadHash(payload: object): string {
  const { operationId: _ignored, ...rest } = payload as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(stable(rest))).digest("hex");
}

export function operationConflict(message: string): HttpException {
  return new HttpException(409, message, {
    code: OPERATION_CODES.PAYLOAD_MISMATCH,
  });
}

export function operationCancelled(): HttpException {
  return new HttpException(
    409,
    "This payment attempt was cancelled and the customer voucher was given back. Press Complete again to start a new attempt.",
    { code: OPERATION_CODES.CANCELLED },
  );
}

export function assertSameOperationPayload(
  stored: { operationPayloadHash: string | null; serial?: string | null; id?: number },
  payloadHash: string,
) {
  if (stored.operationPayloadHash !== payloadHash)
    throw operationConflict(
      `This checkout attempt was already recorded as invoice ${stored.serial ?? `#${stored.id ?? "?"}`} with different contents (409). Check that invoice before charging again; pressing again starts a new attempt.`,
    );
}

const claimed = new Set<string>();

export function claimOperation(operationId: string): boolean {
  if (claimed.has(operationId)) return false;
  claimed.add(operationId);
  return true;
}

export function releaseOperation(operationId: string) {
  claimed.delete(operationId);
}

export function isOperationClaimed(operationId: string): boolean {
  return claimed.has(operationId);
}

// Runs `fn` while holding the claim; 409 OPERATION_IN_PROGRESS when another
// request (or the reconciler) holds it.
export async function withOperationClaim<T>(
  operationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!claimOperation(operationId))
    throw new HttpException(
      409,
      "This payment is still being processed — wait a moment and try again.",
      { code: OPERATION_CODES.IN_PROGRESS },
    );
  try {
    return await fn();
  } finally {
    releaseOperation(operationId);
  }
}

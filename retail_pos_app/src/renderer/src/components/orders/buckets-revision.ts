// T-24 (audit R-15) — when the triage list should refetch.
//
// pos_server's `order:buckets` heartbeat (every 30 s) carries `revision`, which
// changes only when the bucket content changes or an order write went through
// the store server. Older servers and the GET /api/order/buckets fallback send
// no revision; then the content itself (minus the `asOf` clock) is the key.
// The list refetches on a new revision or on a user action — never merely
// because a heartbeat arrived — and, when the refetch for the current revision
// failed, again on the next heartbeat (T-24 review P2) until one succeeds.
// Without a server revision the content key also moves once per 5 minutes
// (same bounded reconcile as the server's revision; counts cannot show an
// order replaced by another).

export const BUCKETS_RECONCILE_MS = 5 * 60_000;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function bucketsContentKey(buckets: object): string {
  const { asOf: _asOf, ...content } = buckets as Record<string, unknown>;
  return `content:${canonicalJson(content)}`;
}

// The revision this tick stands for, or null for a failed tick (no buckets).
export function bucketsRevisionOf(
  buckets: object | null,
  serverRevision?: string | null,
  receivedAt = 0,
): string | null {
  if (!buckets) return null;
  if (typeof serverRevision === "string" && serverRevision) return `rev:${serverRevision}`;
  return `${bucketsContentKey(buckets)}|epoch:${Math.floor(receivedAt / BUCKETS_RECONCILE_MS)}`;
}

export interface BucketsSignal {
  seq: number;
  revision: string | null; // revision a refetch was signalled for
  retry: boolean; // that refetch failed — signal again on the next heartbeat
}

// Next refetch signal: bump when a successful tick brings a revision different
// from the one signalled, or the same one whose refetch failed.
export function nextBucketsSignal(prev: BucketsSignal, revision: string | null): BucketsSignal {
  if (revision == null) return prev;
  if (revision === prev.revision && !prev.retry) return prev;
  return { seq: prev.seq + 1, revision, retry: false };
}

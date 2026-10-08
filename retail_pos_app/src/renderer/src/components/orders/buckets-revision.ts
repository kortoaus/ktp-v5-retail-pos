// T-24 (audit R-15) — when the triage list should refetch.
//
// pos_server's `order:buckets` heartbeat (every 30 s) carries `revision`, which
// changes only when the bucket content changes or an order write went through
// the store server. Older servers and the GET /api/order/buckets fallback send
// no revision; then the content itself (minus the `asOf` clock) is the key.
// The list refetches on a new revision or on a user action — never merely
// because a heartbeat arrived.

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
): string | null {
  if (!buckets) return null;
  if (typeof serverRevision === "string" && serverRevision) return `rev:${serverRevision}`;
  return bucketsContentKey(buckets);
}

// Next refetch signal: bump only when a successful tick brings a revision
// different from the last one seen.
export function nextBucketsSignal(
  prev: { seq: number; revision: string | null },
  revision: string | null,
): { seq: number; revision: string | null } {
  if (revision == null || revision === prev.revision) return prev;
  return { seq: prev.seq + 1, revision };
}

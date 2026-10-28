// Event-log hygiene (D-5): EftEvent.detail is bounded (4 KB) and never carries
// headers, keys, secrets or full card numbers. Every detail passes through
// sanitizeDetail before it is written or printed.
export const DETAIL_MAX_CHARS = 4096;

const FORBIDDEN_KEY = /secret|signature|authorization|api_?key|key_?id|password|token|^pan$|card_?number|^headers?$/i;
const ALLOWED_KEY = /^pan_(first_6|last_4)$/;
// 13–19 digit runs (optionally spaced/dashed) look like a PAN → keep last 4.
const PAN_RUN = /\b(?:\d[ -]?){12,18}\d\b/g;

// RFC 9421 header values echoed inside strings: `sig1=:<b64>:` / `sig1=("@method" …);created=…`.
const SIG_VALUE = /sig1=(?::[A-Za-z0-9+/=]*:?|\([^)]*\)[^\s"',}]*)/g;

function maskPan(s: string): string {
  return s.replace(SIG_VALUE, "[redacted]").replace(PAN_RUN, (run) => {
    const digits = run.replace(/\D/g, "");
    return `****${digits.slice(-4)}`;
  });
}

function scrub(value: unknown, depth: number): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return maskPan(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k) && !ALLOWED_KEY.test(k)) continue;
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeDetail(detail: unknown): unknown {
  if (detail == null) return null;
  const clean = scrub(detail, 0);
  const text = JSON.stringify(clean);
  if (text.length <= DETAIL_MAX_CHARS) return clean;
  return { truncated: true, text: `${text.slice(0, DETAIL_MAX_CHARS - 64)}…` };
}

export function eftConsoleLine(input: {
  txnId: string;
  terminalId: number;
  event: string;
  errorClass?: string | null;
  errorCode?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
}): string {
  const parts = [`[eft] txn=${input.txnId} lane=${input.terminalId} ${input.event}`];
  if (input.statusBefore || input.statusAfter) parts.push(`${input.statusBefore ?? "-"}->${input.statusAfter ?? "-"}`);
  if (input.errorClass) parts.push(input.errorClass);
  if (input.errorCode) parts.push(`code=${input.errorCode}`);
  if (input.httpStatus != null) parts.push(String(input.httpStatus));
  if (input.durationMs != null) parts.push(`${input.durationMs}ms`);
  return parts.join(" ");
}

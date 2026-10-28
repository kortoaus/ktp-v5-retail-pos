// SCI request signing — HTTP Message Signatures (RFC 9421 draft components as
// the SCI guides use them), HMAC-SHA256 with secret = part A + part B.
//
//   Content-Digest:  sha-256=:<b64 sha256(exact body bytes)>:      (bodies only)
//   Signature-Input: sig1=("@method" "@authority" "@request-target" "content-digest");created=<unix>;alg="hmac-sha256";keyid="<key_id>"
//   Signature:       sig1=:<b64 hmac(signature base)>:
//
// Signature base = one `"<component>": <value>` line per component, then
// `"@signature-params": <inner list + params>`, joined by "\n" (no trailing
// newline). @authority is host[:port] exactly as the URL has it — never the
// scheme. @request-target is path + query.
//
// Pure functions (no env, no I/O) so the store server and the dev fake share
// one implementation and a fixed vector test pins it.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SignInput {
  method: string;
  url: string;
  body?: string | null;
  keyId: string;
  secret: string;
  created: number; // unix seconds
}

export interface SignedHeaders {
  "Content-Digest"?: string;
  "Signature-Input": string;
  Signature: string;
}

export function contentDigest(body: string): string {
  return `sha-256=:${createHash("sha256").update(Buffer.from(body, "utf8")).digest("base64")}:`;
}

export function signatureParams(components: string[], created: number, keyId: string): string {
  const list = components.map((c) => `"${c}"`).join(" ");
  return `(${list});created=${created};alg="hmac-sha256";keyid="${keyId}"`;
}

export function signatureBase(input: {
  method: string;
  authority: string;
  requestTarget: string;
  contentDigest?: string;
  params: string;
}): string {
  const lines = [
    `"@method": ${input.method.toUpperCase()}`,
    `"@authority": ${input.authority.toLowerCase()}`,
    `"@request-target": ${input.requestTarget}`,
  ];
  if (input.contentDigest) lines.push(`"content-digest": ${input.contentDigest}`);
  lines.push(`"@signature-params": ${input.params}`);
  return lines.join("\n");
}

export function hmacBase64(secret: string, base: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(base, "utf8").digest("base64");
}

export function signRequest(input: SignInput): SignedHeaders {
  const u = new URL(input.url);
  const hasBody = input.body != null;
  const digest = hasBody ? contentDigest(input.body as string) : undefined;
  const components = ["@method", "@authority", "@request-target", ...(hasBody ? ["content-digest"] : [])];
  const params = signatureParams(components, input.created, input.keyId);
  const base = signatureBase({
    method: input.method,
    authority: u.host,
    requestTarget: `${u.pathname}${u.search}`,
    contentDigest: digest,
    params,
  });
  const headers: SignedHeaders = {
    "Signature-Input": `sig1=${params}`,
    Signature: `sig1=:${hmacBase64(input.secret, base)}:`,
  };
  if (digest) headers["Content-Digest"] = digest;
  return headers;
}

// ── Verification (used by the dev fake SCI and by tests) ─────────────────────

export interface ParsedSignatureInput {
  components: string[];
  created: number;
  keyId: string;
  params: string;
}

export function parseSignatureInput(header: string | undefined): ParsedSignatureInput | null {
  if (!header) return null;
  const m = /^sig1=(\(([^)]*)\);(.*))$/.exec(header.trim());
  if (!m) return null;
  const components = (m[2].match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1));
  const created = Number(/(?:^|;)created=(\d+)/.exec(m[3])?.[1]);
  const keyId = /(?:^|;)keyid="([^"]*)"/.exec(m[3])?.[1];
  if (!Number.isInteger(created) || !keyId) return null;
  return { components, created, keyId, params: m[1] };
}

export type VerifyFailure = "missing" | "digest" | "components" | "skew" | "mismatch";

export function verifyRequest(input: {
  method: string;
  authority: string;
  requestTarget: string;
  body: string | null;
  signatureInput?: string;
  signature?: string;
  contentDigestHeader?: string;
  secretFor: (keyId: string) => string | null;
  nowSeconds: number;
  maxSkewSeconds?: number;
}): { ok: true; keyId: string } | { ok: false; reason: VerifyFailure; keyId?: string } {
  const parsed = parseSignatureInput(input.signatureInput);
  const sig = /^sig1=:([A-Za-z0-9+/=]+):$/.exec(input.signature?.trim() ?? "")?.[1];
  if (!parsed || !sig) return { ok: false, reason: "missing" };
  const hasBody = input.body != null && input.body !== "";
  const required = ["@method", "@authority", "@request-target", ...(hasBody ? ["content-digest"] : [])];
  if (required.join(" ") !== parsed.components.join(" ")) return { ok: false, reason: "components", keyId: parsed.keyId };
  if (hasBody && input.contentDigestHeader !== contentDigest(input.body as string))
    return { ok: false, reason: "digest", keyId: parsed.keyId };
  if (Math.abs(input.nowSeconds - parsed.created) >= (input.maxSkewSeconds ?? 300))
    return { ok: false, reason: "skew", keyId: parsed.keyId };
  const secret = input.secretFor(parsed.keyId);
  if (secret == null) return { ok: false, reason: "mismatch", keyId: parsed.keyId };
  const base = signatureBase({
    method: input.method,
    authority: input.authority,
    requestTarget: input.requestTarget,
    contentDigest: hasBody ? input.contentDigestHeader : undefined,
    params: parsed.params,
  });
  const expected = Buffer.from(hmacBase64(secret, base), "base64");
  const given = Buffer.from(sig, "base64");
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "mismatch", keyId: parsed.keyId };
  return { ok: true, keyId: parsed.keyId };
}

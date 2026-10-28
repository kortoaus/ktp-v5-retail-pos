// SCI (Simple Cloud Integration) implementation of EftProvider.
// API facts: the 2026-10-28 SCI API notes in ktpv5-rooms/surveys/; spec S-3 §5.
//
// - Pairing API: POST <EFT_SCI_PAIRING_API_URL>/v1/progress-pairing with
//   "Authorization: ApiKey <key>" (not signed).
// - SCI API: base URL from the pairing row (never hardcoded), every call signed
//   (sci.signing.ts) with secret = part A (env) + part B (pairing row).
// - fetch: 70 s for long polls, 15 s otherwise, redirect "error" (a redirect
//   would re-send a signed request somewhere we did not sign for).
// Nothing here logs: the engine writes the event log from the returned
// HttpMeta / ProviderError, which never carry headers or secrets.
import type {
  ActionForm,
  CardDetails,
  CreateTxnInput,
  EftProvider,
  FinancialStatus,
  HttpMeta,
  PairResult,
  PairingCredentials,
  PollOutcome,
  PosInstructions,
  ProviderError,
  ProviderResult,
  ProviderTxnAnswer,
} from "../provider";
import { signRequest } from "./sci.signing";

export const SCI_POLL_TIMEOUT_MS = 70_000;
export const SCI_CALL_TIMEOUT_MS = 15_000;
const ERROR_DETAIL_MAX = 4096;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SciProviderOptions {
  pairingApiUrl: string;
  pairingApiKey: string;
  signingSecretPartA: string;
  fetchImpl?: FetchLike;
  /** unix ms; `created` = floor(now / 1000). */
  now?: () => number;
  pollTimeoutMs?: number;
  callTimeoutMs?: number;
}

/** A 1.0 request-flag set (A-10). */
const REQUEST_FLAGS = {
  print_merchant_receipt: true,
  prompt_customer_receipt: false,
  verify_signature_on_terminal: false,
  pos_auto_print_signature_receipt: false,
} as const;

type RawResponse = { status: number | null; body: unknown; http: HttpMeta; networkError?: string };

function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (err && typeof err === "object" && typeof (err as Record<string, unknown>).code === "string")
    return (err as Record<string, string>).code;
  if (typeof err === "string") return err;
  if (typeof b.code === "string") return b.code;
  const errors = b.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0].code === "string") return errors[0].code;
  return null;
}

function excerpt(body: unknown): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { body: text.length > ERROR_DETAIL_MAX ? `${text.slice(0, ERROR_DETAIL_MAX)}…` : text };
}

/** HTTP/transport failure → error class (S-3 §6). */
export function classifySciError(status: number | null, body: unknown, networkError?: string): ProviderError {
  if (status == null) {
    const timedOut = /timeout|aborted/i.test(networkError ?? "");
    return {
      errorClass: "NET",
      errorCode: timedOut ? "SCI_TIMEOUT" : "FETCH_FAILED",
      message: networkError ?? "network error",
      retryable: true,
    };
  }
  const code = errorCodeOf(body);
  const lc = (code ?? "").toLowerCase();
  const detail = excerpt(body);
  if (lc === "no_active_pairings_found")
    return { errorClass: "PAIR", errorCode: "no_active_pairings_found", message: "No active pairing", retryable: false, unpaired: true, detail };
  if (lc === "no_valid_signatures_found")
    return { errorClass: "PAIR", errorCode: "no_valid_signatures_found", message: "Signature rejected", retryable: false, detail };
  if (status === 424 || lc === "device_not_connected")
    return { errorClass: "TERM", errorCode: "device_not_connected", message: "Terminal not connected", retryable: false, detail };
  if (lc === "transaction_refused")
    return { errorClass: "TERM", errorCode: "TRANSACTION_REFUSED", message: "Terminal refused the transaction", retryable: false, detail };
  if (status === 401 || status === 403)
    return { errorClass: "PAIR", errorCode: code ?? `HTTP_${status}`, message: "Not authorised", retryable: false, detail };
  if (status >= 500)
    return { errorClass: "NET", errorCode: code ?? `HTTP_${status}`, message: "Payment service error", retryable: true, detail };
  return { errorClass: "POS", errorCode: code ?? `HTTP_${status}`, message: "Unexpected answer", retryable: false, detail };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function maskedCard(raw: unknown): CardDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: CardDetails = {};
  if (typeof r.entry_mode === "string") out.entry_mode = r.entry_mode.slice(0, 32);
  if (typeof r.scheme_name === "string") out.scheme_name = r.scheme_name.slice(0, 32);
  if (typeof r.pan_first_6 === "string" && /^\d{0,6}$/.test(r.pan_first_6)) out.pan_first_6 = r.pan_first_6;
  if (typeof r.pan_last_4 === "string" && /^\d{0,4}$/.test(r.pan_last_4)) out.pan_last_4 = r.pan_last_4;
  return Object.keys(out).length ? out : null;
}

function posInstructionsOf(raw: unknown): PosInstructions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const auto = Array.isArray(r.auto_actions) ? r.auto_actions.filter((a): a is string => typeof a === "string") : [];
  const form = r.action_form && typeof r.action_form === "object" ? (r.action_form as ActionForm) : null;
  if (!auto.length && !form) return null;
  return { auto_actions: auto, action_form: form };
}

function amountsOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isInteger(v)) out[k] = v as number;
  return out;
}

const STATUSES = new Set(["PENDING", "AWAITING_POS", "FINALISED"]);
const FINANCIAL = new Set(["APPROVED", "DECLINED", "CANCELLED", "UNKNOWN"]);

/** SCI transaction body (`data`-wrapped or bare) → normalised answer, or null on an unexpected shape. */
export function normaliseSciTransaction(body: unknown): ProviderTxnAnswer | null {
  if (!body || typeof body !== "object") return null;
  const wrapped = (body as Record<string, unknown>).data;
  const d = (wrapped && typeof wrapped === "object" ? wrapped : body) as Record<string, unknown>;
  const id = str(d.id);
  const version = d.version;
  const status = str(d.status);
  if (!id || !Number.isInteger(version) || !status || !STATUSES.has(status)) return null;
  const fin = str(d.result_financial_status);
  return {
    providerTxnId: id,
    providerVersion: version as number,
    status: status as ProviderTxnAnswer["status"],
    message: str(d.message),
    financialStatus: fin && FINANCIAL.has(fin) ? (fin as FinancialStatus) : status === "FINALISED" ? "UNKNOWN" : null,
    resultAmounts: amountsOf(d.result_amounts),
    merchantReceipt: str(d.merchant_receipt),
    customerReceipt: str(d.customer_receipt),
    cardDetails: maskedCard(d.result_card_details),
    posInstructions: posInstructionsOf(d.pos_instructions),
  };
}

export class SciProvider implements EftProvider {
  readonly id = "sci" as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly opts: SciProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
  }

  private async send(
    method: "GET" | "POST",
    url: string,
    opts: { body?: string; headers?: Record<string, string>; timeoutMs: number },
  ): Promise<RawResponse> {
    const started = Date.now();
    const http: HttpMeta = { method, path: pathOf(url), status: null, durationMs: 0 };
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: { Accept: "application/json", ...(opts.body != null ? { "Content-Type": "application/json" } : {}), ...opts.headers },
        body: opts.body,
        redirect: "error",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      const text = await res.text();
      http.status = res.status;
      http.durationMs = Date.now() - started;
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text.slice(0, ERROR_DETAIL_MAX);
        }
      }
      return { status: res.status, body, http };
    } catch (e) {
      http.durationMs = Date.now() - started;
      const name = e instanceof Error ? e.name : "";
      const msg = e instanceof Error ? e.message : String(e);
      return { status: null, body: null, http, networkError: `${name}: ${msg}`.slice(0, 200) };
    }
  }

  private signed(
    creds: PairingCredentials,
    method: "GET" | "POST",
    url: string,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<RawResponse> {
    const headers = signRequest({
      method,
      url,
      body: body ?? null,
      keyId: creds.keyId,
      secret: this.opts.signingSecretPartA + creds.signingSecretPartB,
      created: Math.floor(this.now() / 1000),
    });
    return this.send(method, url, { body, headers: { ...headers }, timeoutMs });
  }

  private url(creds: PairingCredentials, path: string): string {
    return `${creds.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private fail<T>(raw: RawResponse): ProviderResult<T> {
    return { ok: false, error: classifySciError(raw.status, raw.body, raw.networkError), http: raw.http };
  }

  async pair(input: { pairingCode: string; nickname?: string | null }): Promise<ProviderResult<PairResult>> {
    const url = `${this.opts.pairingApiUrl.replace(/\/+$/, "")}/v1/progress-pairing`;
    const body = JSON.stringify({
      pairing_code: input.pairingCode,
      ...(input.nickname ? { pairing_nickname: input.nickname } : {}),
    });
    const raw = await this.send("POST", url, {
      body,
      headers: { Authorization: `ApiKey ${this.opts.pairingApiKey}` },
      timeoutMs: this.opts.callTimeoutMs ?? SCI_CALL_TIMEOUT_MS,
    });
    if (raw.status == null || raw.status >= 300) {
      const err = classifySciError(raw.status, raw.body, raw.networkError);
      if (raw.status != null && raw.status < 500 && err.errorClass === "POS") err.errorClass = "PAIR";
      return { ok: false, error: err, http: raw.http };
    }
    const w = raw.body as Record<string, unknown> | null;
    const d = ((w && typeof w.data === "object" && w.data) || w || {}) as Record<string, unknown>;
    const pairingId = str(d.pairing_id);
    const keyId = str(d.key_id);
    const partB = str(d.signing_secret_part_b);
    const baseUrl = str(d.sci_api_base_url);
    const confirmationCode = d.confirmation_code == null ? null : String(d.confirmation_code);
    const baseOk = baseUrl ? this.acceptableBaseUrl(baseUrl) : false;
    if (!pairingId || !keyId || !partB || !baseUrl || !confirmationCode || !baseOk) {
      return {
        ok: false,
        error: { errorClass: "POS", errorCode: baseUrl && !baseOk ? "BASE_URL_REJECTED" : "UNEXPECTED_SHAPE", message: "Unexpected pairing answer", retryable: false },
        http: raw.http,
      };
    }
    return {
      ok: true,
      http: raw.http,
      value: {
        pairingId,
        keyId,
        signingSecretPartB: partB,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        confirmationCode,
        tid: d.tid == null ? null : String(d.tid),
        pairingNickname: str(d.pairing_nickname),
        terminalNickname: str(d.terminal_nickname),
      },
    };
  }

  /** http(s) only; https required when the pairing API itself is https. */
  private acceptableBaseUrl(baseUrl: string): boolean {
    try {
      const u = new URL(baseUrl);
      if (u.username || u.password) return false;
      if (u.protocol === "https:") return true;
      return u.protocol === "http:" && new URL(this.opts.pairingApiUrl).protocol === "http:";
    } catch {
      return false;
    }
  }

  async pairingInfo(creds: PairingCredentials): Promise<ProviderResult<Record<string, unknown>>> {
    const raw = await this.signed(creds, "GET", this.url(creds, "/v1/pairing-info"), undefined, this.opts.callTimeoutMs ?? SCI_CALL_TIMEOUT_MS);
    if (raw.status !== 200) return this.fail(raw);
    const b = raw.body as Record<string, unknown> | null;
    const d = (b && typeof b.data === "object" && b.data ? b.data : b ?? {}) as Record<string, unknown>;
    return { ok: true, value: d, http: raw.http };
  }

  async unpair(creds: PairingCredentials): Promise<ProviderResult<null>> {
    const raw = await this.signed(creds, "POST", this.url(creds, "/v1/unpair"), "{}", this.opts.callTimeoutMs ?? SCI_CALL_TIMEOUT_MS);
    if (raw.status !== 204 && raw.status !== 200) return this.fail(raw);
    return { ok: true, value: null, http: raw.http };
  }

  async createTransaction(creds: PairingCredentials, input: CreateTxnInput): Promise<ProviderResult<ProviderTxnAnswer>> {
    const details =
      input.kind === "PURCHASE"
        ? {
            purchase_details: {
              purchase_amount: input.amountCents,
              ...(input.surchargeCents > 0 ? { surcharge_amount: input.surchargeCents } : {}),
            },
          }
        : { refund_details: { refund_amount: input.amountCents } };
    const body = JSON.stringify({ ...details, ...REQUEST_FLAGS });
    const raw = await this.signed(creds, "POST", this.url(creds, "/v1/transactions"), body, this.opts.callTimeoutMs ?? SCI_CALL_TIMEOUT_MS);
    if (raw.status == null || raw.status >= 300) return this.fail(raw);
    const answer = normaliseSciTransaction(raw.body);
    if (!answer)
      return { ok: false, error: { errorClass: "POS", errorCode: "UNEXPECTED_SHAPE", message: "Unexpected create answer", retryable: false, detail: excerpt(raw.body) }, http: raw.http };
    return { ok: true, value: answer, http: raw.http };
  }

  async pollTransaction(creds: PairingCredentials, providerTxnId: string, minVersion: number | undefined): Promise<ProviderResult<PollOutcome>> {
    const q = minVersion != null ? `?min_version=${minVersion}` : "";
    const raw = await this.signed(
      creds,
      "GET",
      this.url(creds, `/v1/transactions/${encodeURIComponent(providerTxnId)}${q}`),
      undefined,
      this.opts.pollTimeoutMs ?? SCI_POLL_TIMEOUT_MS,
    );
    if (raw.status === 404 && (errorCodeOf(raw.body) ?? "").toLowerCase() === "transaction_not_found_within_timeout")
      return { ok: true, value: { kind: "not_yet" }, http: raw.http };
    if (raw.status !== 200) {
      const r = this.fail<PollOutcome>(raw);
      if (!r.ok && raw.status === 404) r.error.errorCode = errorCodeOf(raw.body) ?? "transaction_not_found";
      return r;
    }
    const answer = normaliseSciTransaction(raw.body);
    if (!answer)
      return { ok: false, error: { errorClass: "POS", errorCode: "UNEXPECTED_SHAPE", message: "Unexpected poll answer", retryable: true, detail: excerpt(raw.body) }, http: raw.http };
    return { ok: true, value: { kind: "answer", answer }, http: raw.http };
  }

  async submitAction(creds: PairingCredentials, submitUrl: string, inputs: Record<string, string>): Promise<ProviderResult<ProviderTxnAnswer | null>> {
    // Only ever sign toward this pairing's own SCI origin.
    let target: URL;
    try {
      target = new URL(submitUrl, `${creds.baseUrl.replace(/\/+$/, "")}/`);
    } catch {
      target = new URL("invalid://x");
    }
    if (target.origin !== new URL(creds.baseUrl).origin)
      return { ok: false, error: { errorClass: "POS", errorCode: "SUBMIT_URL_FOREIGN", message: "Action URL is not on the pairing's SCI host", retryable: false }, http: null };
    const raw = await this.signed(creds, "POST", target.toString(), JSON.stringify(inputs), this.opts.callTimeoutMs ?? SCI_CALL_TIMEOUT_MS);
    if (raw.status == null || raw.status >= 300) return this.fail(raw);
    return { ok: true, value: normaliseSciTransaction(raw.body), http: raw.http };
  }

  async cancel(): Promise<{ supported: false }> {
    // A-4: the public guides document no cancel endpoint (OpenAPI renders empty);
    // the cashier cancels on the terminal and the next poll carries the result.
    return { supported: false };
  }
}

// Stripe Terminal (Tap to Pay) — the only outbound-to-Stripe surface this
// server has. Two REST calls, deliberately hand-rolled over `fetch` rather
// than the `stripe` npm package (BACKLOG §Z: 태블릿 Tap to Pay 도입 시 서버
// 표면 최소화 — 두 개의 REST 호출에 SDK 의존성을 추가하지 않는다).
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// The Fast Checkout tablet (`ktpv5-pos-retail-android`) is otherwise a pure
// HTTP client of this server ("서버 무변경" — BACKLOG §Z). Stripe Terminal
// breaks that rule for exactly one reason: a connection token MUST be minted
// with the secret key, and the secret key must never live on the tablet.
// Same for the PaymentIntent: the amount is authoritative only if the server
// creates it. Nothing else about the sale path changes — the tablet still
// POSTs the same `/api/sale` invoice with `payments: [{type:"CREDIT",...}]`;
// Stripe is the acquiring side, not a new tender.
//
// LOCATION HANDLING (design note)
// -------------------------------
// Stripe Terminal requires a Location id to connect a Tap to Pay reader
// (`easyConnect({ discoveryMethod: 'tapToPay', locationId })`). We resolve it
// *lazily inside the connection-token call* rather than exposing a separate
// `POST /api/stripe/location` route, because:
//   1. the tablet needs the token and the location id at the same moment, so
//      one round trip beats two, and
//   2. a location route would be a write endpoint that nothing calls in
//      steady state — dead surface the moment `STRIPE_LOCATION_ID` is pinned.
// Resolution order: `STRIPE_LOCATION_ID` from .env → process-lifetime cache →
// the account's first existing Terminal Location (reused, never duplicated) →
// a freshly created "KTP Dev" location. Creation logs the id at `console.warn`
// with an explicit "pin this in .env" instruction, so the owner can make the
// lookup deterministic. Reusing before creating is what keeps a restart loop
// from littering the Stripe account with locations.
//
// MISSING KEY
// -----------
// `STRIPE_SECRET_KEY` absent → every route in this module answers a clean
// `503 { ok:false, msg:"Stripe is not configured" }`. No throw at boot, no
// stack trace, no partial 500. This is a deliberate departure from the fleet's
// "missing env vars fail silently at runtime" habit (workspace CLAUDE.md
// "Known Systemic Patterns"): the tablet probes this endpoint once per session
// and hides the Tap to Pay button on exactly this message.

import { STRIPE_LOCATION_ID, STRIPE_SECRET_KEY } from "../../libs/constants";
import { HttpException } from "../../libs/exceptions";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 15000;

/** The exact string the tablet's probe matches on. Do not reword casually. */
export const STRIPE_NOT_CONFIGURED_MSG = "Stripe is not configured";

/** 503 — the service exists but this deployment has no key. */
class StripeNotConfiguredException extends HttpException {
  constructor() {
    super(503, STRIPE_NOT_CONFIGURED_MSG);
  }
}

/** 502 — we reached (or failed to reach) Stripe and it said no. */
class StripeUpstreamException extends HttpException {
  constructor(message: string) {
    super(502, message);
  }
}

export function isStripeConfigured(): boolean {
  return STRIPE_SECRET_KEY.length > 0;
}

type StripeErrorBody = {
  error?: { message?: string; type?: string; code?: string };
};

async function stripeCall<T>(
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string>,
): Promise<T> {
  if (!isStripeConfigured()) {
    throw new StripeNotConfiguredException();
  }

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
  } catch (e) {
    // Network / DNS / timeout. One line, no stack — the store's uplink being
    // down is an operational fact, not a bug worth a trace in the PM2 log.
    console.error(
      `[stripe] ${method} ${path} — unreachable:`,
      e instanceof Error ? e.message : e,
    );
    throw new StripeUpstreamException("Cannot reach Stripe. Check the connection.");
  }

  const body = (await res.json().catch(() => null)) as (T & StripeErrorBody) | null;

  if (!res.ok || body === null) {
    const err = body?.error;
    const msg = err?.message ?? `Stripe request failed (${res.status})`;
    console.error(
      `[stripe] ${method} ${path} → ${res.status} ${err?.type ?? "unknown"}${
        err?.code ? `/${err.code}` : ""
      }: ${msg}`,
    );
    throw new StripeUpstreamException(`Stripe: ${msg}`);
  }

  return body as T;
}

// ── Terminal Location ───────────────────────────────────────────────────────

type StripeLocation = { id: string; display_name?: string };

/** Process-lifetime memo. Cleared by a restart, which is fine — the lookup
 * below reuses the account's existing location rather than creating another. */
let cachedLocationId: string | null = null;

/**
 * The Location id the tablet must pass to `easyConnect`. See the design note
 * at the top of this file for the resolution order.
 */
export async function ensureTerminalLocationId(): Promise<string> {
  if (STRIPE_LOCATION_ID) return STRIPE_LOCATION_ID;
  if (cachedLocationId) return cachedLocationId;

  const listed = await stripeCall<{ data?: StripeLocation[] }>(
    "GET",
    "/terminal/locations?limit=1",
  );
  const existing = listed.data?.[0];
  if (existing?.id) {
    cachedLocationId = existing.id;
    console.warn(
      `[stripe] Reusing existing Terminal Location ${existing.id}` +
        `${existing.display_name ? ` ("${existing.display_name}")` : ""}. ` +
        `Pin it in retail_pos_server/.env as STRIPE_LOCATION_ID=${existing.id} ` +
        `to make this deterministic.`,
    );
    return existing.id;
  }

  const created = await stripeCall<StripeLocation>("POST", "/terminal/locations", {
    display_name: "KTP Dev",
    "address[line1]": "1 Dev Street",
    "address[city]": "Sydney",
    "address[state]": "NSW",
    "address[postal_code]": "2000",
    "address[country]": "AU",
  });

  cachedLocationId = created.id;
  console.warn(
    `[stripe] Created Terminal Location "KTP Dev" ${created.id}. ` +
      `PIN IT: add STRIPE_LOCATION_ID=${created.id} to retail_pos_server/.env ` +
      `so a restart does not have to look it up again.`,
  );
  return created.id;
}

// ── Connection token ────────────────────────────────────────────────────────

export type ConnectionTokenResult = {
  /** Stripe connection token secret — feeds the SDK's `tokenProvider`. */
  secret: string;
  /** Terminal Location id — feeds `easyConnect({ locationId })`. */
  locationId: string;
};

/**
 * `POST /v1/terminal/connection_tokens`.
 *
 * The token is deliberately created WITHOUT a `location` scope: scoping a
 * connection token restricts it to readers registered at that location, and a
 * simulated Tap to Pay reader is not registered anywhere. The location id is
 * returned alongside instead, and the tablet passes it to `easyConnect`.
 */
export async function createConnectionTokenService(): Promise<{
  ok: true;
  result: ConnectionTokenResult;
}> {
  const locationId = await ensureTerminalLocationId();
  const token = await stripeCall<{ secret: string }>(
    "POST",
    "/terminal/connection_tokens",
  );

  return { ok: true, result: { secret: token.secret, locationId } };
}

// ── PaymentIntent ───────────────────────────────────────────────────────────

export type PaymentIntentResult = {
  id: string;
  client_secret: string;
};

export type PaymentIntentContext = {
  terminalId?: number | null;
  terminalName?: string | null;
  userId?: number | null;
};

/**
 * `POST /v1/payment_intents` for a card-present (Tap to Pay) charge.
 *
 * `amount` is integer cents — the SAME figure the tablet's `usePaymentCal`
 * produced as `cal.total` (bill + credit surcharge). The server does not
 * recompute it here: `/api/sale` is where the arithmetic is re-validated, and
 * duplicating that derivation in two places is exactly how the two drift.
 * What this function does guarantee is that the amount Stripe charges was
 * minted server-side against a key the tablet never sees.
 *
 * `capture_method: automatic` — the retail POS has no authorise-then-capture
 * step; the invoice is written the moment the charge succeeds. (The hold →
 * capture pattern in BACKLOG §X-… is the *e-commerce* order flow, not this.)
 */
export async function createPaymentIntentService(
  amount: number,
  ctx: PaymentIntentContext = {},
): Promise<{ ok: true; result: PaymentIntentResult }> {
  const form: Record<string, string> = {
    amount: String(amount),
    currency: "aud",
    "payment_method_types[]": "card_present",
    capture_method: "automatic",
    "metadata[source]": "ktpv5-fast-checkout",
  };
  if (ctx.terminalId != null) form["metadata[terminalId]"] = String(ctx.terminalId);
  if (ctx.terminalName) form["metadata[terminalName]"] = ctx.terminalName;
  if (ctx.userId != null) form["metadata[userId]"] = String(ctx.userId);

  const intent = await stripeCall<{ id: string; client_secret: string | null }>(
    "POST",
    "/payment_intents",
    form,
  );

  if (!intent.client_secret) {
    // Should not happen on a fresh create; treat as upstream weirdness rather
    // than handing the tablet an unusable envelope.
    throw new StripeUpstreamException("Stripe returned a PaymentIntent without a client_secret");
  }

  return { ok: true, result: { id: intent.id, client_secret: intent.client_secret } };
}

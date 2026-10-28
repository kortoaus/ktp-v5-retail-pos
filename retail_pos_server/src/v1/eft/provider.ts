// Provider-neutral EFT adapter interface (retail-eftpos D-2). The store server's
// engine (eft.engine.ts) talks only to this; `sci/` implements it today, a
// Linkly implementation plugs in later behind the same calls. Answers are
// normalised to ProviderTxnAnswer so the engine's state machine never reads a
// vendor body.

export type EftProviderId = "sci";
export type EftErrorClass = "NET" | "PAIR" | "TERM" | "BANK" | "TIMEOUT" | "POS";
export type ProviderTxnStatus = "PENDING" | "AWAITING_POS" | "FINALISED";
export type FinancialStatus = "APPROVED" | "DECLINED" | "CANCELLED" | "UNKNOWN";

/** Decrypted credentials of one pairing. Never leaves the store server. */
export interface PairingCredentials {
  pairingId: string;
  keyId: string;
  signingSecretPartB: string;
  baseUrl: string;
}

export interface PairResult {
  pairingId: string;
  keyId: string;
  signingSecretPartB: string;
  baseUrl: string;
  confirmationCode: string;
  tid: string | null;
  pairingNickname: string | null;
  terminalNickname: string | null;
}

/** Masked card details only (never a full PAN). */
export interface CardDetails {
  entry_mode?: string;
  pan_first_6?: string;
  pan_last_4?: string;
  scheme_name?: string;
}

export interface PosInstructions {
  auto_actions: string[];
  action_form: ActionForm | null;
}

export interface ActionForm {
  layout?: unknown;
  properties?: Record<string, ActionFormProperty>;
  details?: Record<string, unknown>;
}

export interface ActionFormProperty {
  type?: string;
  label?: string;
  name?: string;
  submit_url?: string;
  action?: string;
  [extra: string]: unknown;
}

export interface ProviderTxnAnswer {
  providerTxnId: string;
  providerVersion: number;
  status: ProviderTxnStatus;
  message: string | null;
  financialStatus: FinancialStatus | null;
  resultAmounts: Record<string, number> | null;
  merchantReceipt: string | null;
  customerReceipt: string | null;
  cardDetails: CardDetails | null;
  posInstructions: PosInstructions | null;
}

/** HTTP facts for the event log (path without host; no headers, ever). */
export interface HttpMeta {
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
}

export interface ProviderError {
  errorClass: EftErrorClass;
  errorCode: string;
  message: string;
  /** A later retry of the same call can succeed (network, 5xx). */
  retryable: boolean;
  /** The provider says this pairing is gone — mark it inactive. */
  unpaired?: boolean;
  /** Bounded, sanitised excerpt of the provider's error body. */
  detail?: Record<string, unknown>;
}

export type ProviderResult<T> =
  | { ok: true; value: T; http: HttpMeta }
  | { ok: false; error: ProviderError; http: HttpMeta | null };

export type PollOutcome = { kind: "answer"; answer: ProviderTxnAnswer } | { kind: "not_yet" };

export interface CreateTxnInput {
  kind: "PURCHASE" | "REFUND";
  amountCents: number;
  surchargeCents: number;
}

export interface EftProvider {
  readonly id: EftProviderId;
  pair(input: { pairingCode: string; nickname?: string | null }): Promise<ProviderResult<PairResult>>;
  pairingInfo(creds: PairingCredentials): Promise<ProviderResult<Record<string, unknown>>>;
  unpair(creds: PairingCredentials): Promise<ProviderResult<null>>;
  createTransaction(creds: PairingCredentials, input: CreateTxnInput): Promise<ProviderResult<ProviderTxnAnswer>>;
  /** Long poll. `minVersion` undefined → current state at once (recovery). */
  pollTransaction(
    creds: PairingCredentials,
    providerTxnId: string,
    minVersion: number | undefined,
  ): Promise<ProviderResult<PollOutcome>>;
  /** Relay an Action Framework button's submit_url with input values keyed by name. */
  submitAction(
    creds: PairingCredentials,
    submitUrl: string,
    inputs: Record<string, string>,
  ): Promise<ProviderResult<ProviderTxnAnswer | null>>;
  /** Cancel upstream, when the provider has a cancel call. */
  cancel(creds: PairingCredentials, providerTxnId: string): Promise<{ supported: false } | ProviderResult<null>>;
}

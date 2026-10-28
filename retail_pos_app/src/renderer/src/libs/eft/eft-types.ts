// Integrated EFTPOS lane API shapes (retail-eftpos T-7) — what the store
// server's `/api/eft/*` answers (retail_pos_server/AGENTS.md "Integrated
// EFTPOS", eft.engine.ts laneView / pairingView / lanes). Types only: the
// pure flow (eft-flow.ts), the layout walker (action-form.ts) and
// service/eft.service.ts all read these. Money is cents.

export type EftErrorClass = "NET" | "PAIR" | "TERM" | "BANK" | "TIMEOUT" | "POS";

export type EftTxnStatus =
  | "CREATING"
  | "PENDING"
  | "AWAITING_POS"
  | "FINALISED"
  | "FAILED"
  | "TIMEOUT"
  | "FINALISED_BY_OVERRIDE"
  | "CANCELLED_BY_OVERRIDE";

export type EftFinancialStatus = "APPROVED" | "DECLINED" | "CANCELLED" | "UNKNOWN";

/** One Action Framework property as the till sees it (submit_url → `submit: true`). */
export interface EftActionProperty {
  type?: string;
  label?: string;
  name?: string;
  action?: string;
  submit?: boolean;
  mime?: string;
  encoding?: string;
  data?: string;
  [extra: string]: unknown;
}

export interface EftActionForm {
  layout?: unknown;
  properties?: Record<string, EftActionProperty>;
  details?: Record<string, unknown>;
}

/** GET /api/eft/transactions/:id (and every other transaction answer). */
export interface EftTxn {
  id: string;
  version: number;
  kind: "PURCHASE" | "REFUND";
  operationId: string;
  amountCents: number;
  surchargeCents: number;
  status: EftTxnStatus;
  message: string | null;
  /** Cashier text with the error class in brackets — shown verbatim. */
  displayMessage: string;
  financialStatus: EftFinancialStatus | null;
  resultAmounts: Record<string, number> | null;
  merchantReceipt: string | null;
  customerReceipt: string | null;
  cardDetails: Record<string, unknown> | null;
  actionForm: EftActionForm | null;
  autoActions: string[];
  merchantPrintSeq: number;
  customerPrintSeq: number;
  errorClass: EftErrorClass | null;
  errorCode: string | null;
  overrideAnswer: "YES" | "NO" | null;
  overrideRequired: boolean;
  final: boolean;
  cancelRequested: boolean;
  invoiceId: number | null;
  startedAt: string | null;
  finalisedAt: string | null;
}

/** GET /api/eft/pairings row (no secrets). */
export interface EftPairing {
  id: number;
  provider: string;
  pairingId: string;
  nickname: string | null;
  terminalNickname: string | null;
  tid: string | null;
  active: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  selectedForThisTerminal: boolean;
}

/** POST /api/eft/pairings answer. */
export type EftPairResult = EftPairing & { confirmationCode: string };

/** POST /api/eft/pairings/:id/test answer. */
export interface EftPairingTest {
  ok: boolean;
  lastTestAt: string;
  errorClass: EftErrorClass | null;
  errorCode: string | null;
  message: string;
}

export interface EftLane {
  terminalId: number;
  name: string | null;
  ipAddress: string | null;
  pairing: {
    id: number;
    nickname: string | null;
    terminalNickname: string | null;
    tid: string | null;
    active: boolean;
    lastTestAt: string | null;
    lastTestOk: boolean | null;
    lastError: string | null;
  } | null;
  lastSciOkAt: string | null;
  lastSciErrorAt: string | null;
  lastSciErrorCode: string | null;
  sciReachable: boolean | null;
  lastTransaction: {
    id: string;
    status: EftTxnStatus;
    financialStatus: EftFinancialStatus | null;
    errorClass: EftErrorClass | null;
    errorCode: string | null;
    amountCents: number;
    at: string;
  } | null;
}

/** GET /api/eft/lanes. */
export interface EftLanes {
  serverTime: string;
  configured: { pairing: boolean; signing: boolean };
  activeLoops: number;
  lanes: EftLane[];
}

/** GET /api/eft/transactions/:id/events row. */
export interface EftEvent {
  seq: number;
  at: string;
  source: string;
  event: string;
  httpMethod: string | null;
  httpPath: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  statusBefore: string | null;
  statusAfter: string | null;
  errorClass: string | null;
  errorCode: string | null;
}

/** The till's API answer envelope (libs/api.ts ApiResponse, minus paging). */
export interface EftAnswer<T> {
  ok: boolean;
  status: number;
  msg: string;
  result: T | null;
}

// Persistence seam for the EFT engine. eft.store.prisma.ts is the real one;
// tests use the in-memory store in eft.test-fakes.ts (no test touches a DB).
import type {
  EftEventModel,
  EftPairingModel,
  EftTransactionModel,
  TerminalModel,
} from "../../generated/prisma/models";

export type TxnRow = EftTransactionModel;
export type PairingRow = EftPairingModel;
export type EventRow = EftEventModel;
export type LaneTerminal = Pick<TerminalModel, "id" | "name" | "ipAddress" | "eftPairingId">;

export type TxnStatus = TxnRow["status"];
export type OpenStatus = Extract<TxnStatus, "CREATING" | "PENDING" | "AWAITING_POS">;

export interface NewTxn {
  provider: string;
  eftPairingId: number;
  terminalId: number;
  kind: TxnRow["kind"];
  requestedCents: number;
  surchargeCents: number;
  operationId: string;
  saleOperationId: string;
  createdBy: number | null;
  message: string | null;
}

/** Mutable columns. JSON columns take plain values; null clears them. */
export type TxnPatch = Partial<
  Pick<
    TxnRow,
    | "operationId"
    | "providerTxnId"
    | "providerVersion"
    | "status"
    | "message"
    | "financialStatus"
    | "merchantReceipt"
    | "customerReceipt"
    | "merchantPrintSeq"
    | "customerPrintSeq"
    | "errorClass"
    | "errorCode"
    | "overrideAnswer"
    | "overrideBy"
    | "overrideAt"
    | "cancelRequestedAt"
    | "retiredAt"
    | "finalisedAt"
  >
> & {
  resultAmounts?: unknown;
  cardDetails?: unknown;
  posInstructions?: unknown;
  providerData?: unknown;
};

export interface NewPairing {
  provider: string;
  pairingId: string;
  keyId: string;
  signingSecretPartBEnc: string;
  baseUrl: string;
  tid: string | null;
  pairingNickname: string | null;
  terminalNickname: string | null;
}

export type PairingPatch = Partial<
  Pick<
    PairingRow,
    | "active"
    | "lastTestAt"
    | "lastTestOk"
    | "lastError"
    | "lastSciOkAt"
    | "lastSciErrorAt"
    | "lastSciErrorCode"
  >
>;

export interface NewEvent {
  transactionId: string;
  seq: number;
  at: Date;
  source: "TILL" | "SERVER" | "SCI" | "TERMINAL_OP";
  event: string;
  httpMethod?: string | null;
  httpPath?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  providerVersion?: number | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
  errorClass?: TxnRow["errorClass"];
  errorCode?: string | null;
  detail?: unknown;
}

export class EftDuplicateError extends Error {}

export type DeletePairingOutcome = "deleted" | "missing" | "active" | "in_use";

/** Statuses of an unresolved transaction (with FINALISED + financialStatus UNKNOWN) — the engine's !isFinal. */
export const UNRESOLVED_TXN_STATUSES = ["CREATING", "PENDING", "AWAITING_POS", "TIMEOUT"] as const satisfies readonly TxnStatus[];

export interface EftStore {
  listPairings(): Promise<PairingRow[]>;
  getPairing(id: number): Promise<PairingRow | null>;
  /** Insert or refresh by (provider, pairingId); a re-pair reactivates. */
  upsertPairing(data: NewPairing): Promise<PairingRow>;
  updatePairing(id: number, patch: PairingPatch): Promise<PairingRow>;
  setTerminalPairing(terminalId: number, eftPairingId: number | null): Promise<void>;
  /**
   * T-9 (F-19, F-21): under the pairing row lock (the same one insertTxn takes), delete
   * the row only when it is inactive and no transaction on it is unresolved — CREATING /
   * PENDING / AWAITING_POS / TIMEOUT, or FINALISED with financialStatus UNKNOWN (the
   * engine's isFinal) — and clear Terminal.eftPairingId where it points here. Past
   * EftTransactions keep their rows and EftEvents (eftPairingId → NULL).
   */
  deleteIdlePairing(id: number): Promise<{ outcome: DeletePairingOutcome; terminalsCleared: number }>;
  listLaneTerminals(): Promise<LaneTerminal[]>;
  lastTxnForTerminal(terminalId: number): Promise<TxnRow | null>;

  getTxn(id: string): Promise<TxnRow | null>;
  findTxnByOperation(operationId: string, kind: TxnRow["kind"]): Promise<TxnRow | null>;
  /**
   * Throws EftDuplicateError on (operationId, kind). F-21: checks under the pairing row
   * lock that `data.eftPairingId` exists and is active and inserts in the same DB
   * transaction, so a delete cannot slip in between; null = missing or inactive.
   */
  insertTxn(data: NewTxn): Promise<TxnRow | null>;
  /** `bump` (default true) increments the lane version in the same write. */
  updateTxn(id: string, patch: TxnPatch, opts?: { bump?: boolean }): Promise<TxnRow>;
  listTxnsByStatus(statuses: TxnStatus[]): Promise<TxnRow[]>;

  appendEvent(e: NewEvent): Promise<void>;
  maxEventSeq(transactionId: string): Promise<number>;
  listEvents(transactionId: string): Promise<EventRow[]>;
}

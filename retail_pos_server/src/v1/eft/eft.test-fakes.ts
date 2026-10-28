// In-memory EftStore for the eft tests (no test touches a database).
import {
  EftDuplicateError,
  UNRESOLVED_TXN_STATUSES,
  type EftStore,
  type EventRow,
  type LaneTerminal,
  type NewEvent,
  type NewPairing,
  type NewTxn,
  type PairingPatch,
  type PairingRow,
  type TxnPatch,
  type TxnRow,
  type TxnStatus,
} from "./eft.store";

let cuidSeq = 0;

export class MemoryEftStore implements EftStore {
  pairings: PairingRow[] = [];
  txns = new Map<string, TxnRow>();
  events: EventRow[] = [];
  terminals: LaneTerminal[] = [{ id: 1, name: "Till 1", ipAddress: "10.0.0.11", eftPairingId: null }];

  async listPairings() {
    return this.pairings.map((p) => ({ ...p }));
  }
  async getPairing(id: number) {
    const p = this.pairings.find((x) => x.id === id);
    return p ? { ...p } : null;
  }
  async upsertPairing(data: NewPairing) {
    const now = new Date();
    const existing = this.pairings.find((p) => p.provider === data.provider && p.pairingId === data.pairingId);
    if (existing) {
      Object.assign(existing, data, { active: true, lastError: null, updatedAt: now });
      return { ...existing };
    }
    const row: PairingRow = {
      id: this.pairings.reduce((m, x) => Math.max(m, x.id), 0) + 1,
      ...data,
      active: true,
      lastTestAt: null,
      lastTestOk: null,
      lastError: null,
      lastSciOkAt: null,
      lastSciErrorAt: null,
      lastSciErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    this.pairings.push(row);
    return { ...row };
  }
  async updatePairing(id: number, patch: PairingPatch) {
    const p = this.pairings.find((x) => x.id === id);
    if (!p) throw new Error("no pairing");
    Object.assign(p, patch, { updatedAt: new Date() });
    return { ...p };
  }
  async setTerminalPairing(terminalId: number, eftPairingId: number | null) {
    const t = this.terminals.find((x) => x.id === terminalId);
    if (t) t.eftPairingId = eftPairingId;
  }
  // F-21: every check-then-write below runs without an await in between — the
  // memory store's equivalent of the Prisma store's pairing row lock.
  async deleteIdlePairing(id: number) {
    const i = this.pairings.findIndex((x) => x.id === id);
    if (i < 0) return { outcome: "missing" as const, terminalsCleared: 0 };
    if (this.pairings[i].active) return { outcome: "active" as const, terminalsCleared: 0 };
    const unresolved = [...this.txns.values()].some(
      (t) =>
        t.eftPairingId === id &&
        ((UNRESOLVED_TXN_STATUSES as readonly string[]).includes(t.status) || (t.status === "FINALISED" && t.financialStatus === "UNKNOWN")),
    );
    if (unresolved) return { outcome: "in_use" as const, terminalsCleared: 0 };
    this.pairings.splice(i, 1);
    let terminalsCleared = 0;
    for (const t of this.terminals)
      if (t.eftPairingId === id) {
        t.eftPairingId = null;
        terminalsCleared++;
      }
    for (const t of this.txns.values()) if (t.eftPairingId === id) t.eftPairingId = null; // onDelete: SetNull
    return { outcome: "deleted" as const, terminalsCleared };
  }
  async listLaneTerminals() {
    return this.terminals.map((t) => ({ ...t }));
  }
  async lastTxnForTerminal(terminalId: number) {
    const rows = [...this.txns.values()].filter((t) => t.terminalId === terminalId);
    const last = rows[rows.length - 1];
    return last ? { ...last } : null;
  }

  async getTxn(id: string) {
    const t = this.txns.get(id);
    return t ? { ...t } : null;
  }
  async findTxnByOperation(operationId: string, kind: TxnRow["kind"]) {
    for (const t of this.txns.values()) if (t.operationId === operationId && t.kind === kind) return { ...t };
    return null;
  }
  async insertTxn(data: NewTxn) {
    if (!this.pairings.some((p) => p.id === data.eftPairingId && p.active)) return null; // F-21
    for (const t of this.txns.values())
      if (t.operationId === data.operationId && t.kind === data.kind) throw new EftDuplicateError("dup");
    const now = new Date();
    const row: TxnRow = {
      id: `c${String(++cuidSeq).padStart(8, "0")}`,
      ...data,
      providerTxnId: null,
      providerVersion: null,
      version: 1,
      invoiceId: null,
      status: "CREATING",
      financialStatus: null,
      resultAmounts: null,
      merchantReceipt: null,
      customerReceipt: null,
      cardDetails: null,
      posInstructions: null,
      merchantPrintSeq: 0,
      customerPrintSeq: 0,
      errorClass: null,
      errorCode: null,
      overrideAnswer: null,
      overrideBy: null,
      overrideAt: null,
      cancelRequestedAt: null,
      retiredAt: null,
      providerData: null,
      startedAt: now,
      finalisedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.txns.set(row.id, row);
    return { ...row };
  }
  /** Seed a row as a previous process left it (recovery tests). */
  seedTxn(row: TxnRow) {
    this.txns.set(row.id, { ...row });
  }
  async updateTxn(id: string, patch: TxnPatch, opts?: { bump?: boolean }) {
    const t = this.txns.get(id);
    if (!t) throw new Error("no txn");
    Object.assign(t, JSON.parse(JSON.stringify(patch, (_k, v) => (v === undefined ? undefined : v))), {
      updatedAt: new Date(),
    });
    // JSON round trip turns Dates into strings — restore the Date columns.
    for (const k of ["overrideAt", "cancelRequestedAt", "retiredAt", "finalisedAt"] as const)
      if (k in patch) t[k] = (patch[k] as Date | null | undefined) ?? null;
    if (opts?.bump !== false) t.version += 1;
    return { ...t };
  }
  async listTxnsByStatus(statuses: TxnStatus[]) {
    return [...this.txns.values()].filter((t) => statuses.includes(t.status)).map((t) => ({ ...t }));
  }
  async appendEvent(e: NewEvent) {
    if (this.events.some((x) => x.transactionId === e.transactionId && x.seq === e.seq)) throw new Error("dup seq");
    this.events.push({
      id: this.events.length + 1,
      transactionId: e.transactionId,
      at: e.at,
      seq: e.seq,
      source: e.source,
      event: e.event,
      httpMethod: e.httpMethod ?? null,
      httpPath: e.httpPath ?? null,
      httpStatus: e.httpStatus ?? null,
      durationMs: e.durationMs ?? null,
      providerVersion: e.providerVersion ?? null,
      statusBefore: e.statusBefore ?? null,
      statusAfter: e.statusAfter ?? null,
      errorClass: e.errorClass ?? null,
      errorCode: e.errorCode ?? null,
      detail: (e.detail ?? null) as EventRow["detail"],
    });
  }
  async maxEventSeq(transactionId: string) {
    return this.events.filter((e) => e.transactionId === transactionId).reduce((m, e) => Math.max(m, e.seq), 0);
  }
  async listEvents(transactionId: string) {
    return this.events.filter((e) => e.transactionId === transactionId).sort((a, b) => a.seq - b.seq);
  }
}

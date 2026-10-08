// Test-only fakes for the T-15 ledger tests (not a *.test.ts file, so the
// runner does not execute it on its own). No DB, no network.
import type {
  CrmOutcome,
  CrmOperationState,
  CustomerVoucherCrm,
} from "./customer-voucher.crm";
import type {
  CustomerVoucherOperationStore,
  CvOperationPatch,
  CvOperationRow,
  CvOperationStatus,
} from "./customer-voucher.operation.store";
import { isOpenRow } from "./customer-voucher.operation.store";
import type { CustomerVoucherWire } from "./customer-voucher.types";

export class FakeOpsStore implements CustomerVoucherOperationStore {
  rows: CvOperationRow[] = [];
  // status history per crmRequestId, for state-machine assertions
  history = new Map<string, CvOperationStatus[]>();
  private nextId = 1;
  clock = () => new Date();

  private record(row: CvOperationRow) {
    const list = this.history.get(row.crmRequestId) ?? [];
    if (list[list.length - 1] !== row.status) list.push(row.status);
    this.history.set(row.crmRequestId, list);
  }

  async findByOperationId(operationId: string) {
    return this.rows.filter((r) => r.operationId === operationId).map((r) => ({ ...r }));
  }
  async findByCrmRequestId(crmRequestId: string) {
    const row = this.rows.find((r) => r.crmRequestId === crmRequestId);
    return row ? { ...row } : null;
  }
  async ensureIntent(intent: Parameters<CustomerVoucherOperationStore["ensureIntent"]>[0]) {
    const existing = this.rows.find((r) => r.crmRequestId === intent.crmRequestId);
    if (existing) {
      if (existing.status === "FAILED") {
        existing.status = "INTENT";
        existing.lastError = null;
        existing.updatedAt = this.clock();
        this.record(existing);
      }
      return { ...existing };
    }
    const now = this.clock();
    const row: CvOperationRow = {
      id: this.nextId++,
      ...intent,
      status: "INTENT",
      invoiceId: null,
      crmEventId: null,
      crmVoucherId: null,
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    this.record(row);
    return { ...row };
  }
  async update(id: number, patch: CvOperationPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no row ${id}`);
    const { attempted, ...rest } = patch;
    Object.assign(row, rest);
    if (attempted) row.attempts += 1;
    row.updatedAt = this.clock();
    this.record(row);
    return { ...row };
  }
  // Mirrors linkOperationRowsInTx.
  link(rowIds: number[], invoiceId: number) {
    const rows = this.rows.filter(
      (r) => rowIds.includes(r.id) && r.status === "CONFIRMED" && r.invoiceId == null,
    );
    if (rows.length !== rowIds.length) throw new Error("ledger changed while saving");
    for (const row of rows) {
      row.status = "LINKED";
      row.invoiceId = invoiceId;
      this.record(row);
    }
  }
  async listForReconcile(olderThan: Date) {
    return this.rows.filter((r) => isOpenRow(r) && r.updatedAt < olderThan).map((r) => ({ ...r }));
  }
  async list(statuses: CvOperationStatus[]) {
    return this.rows.filter((r) => statuses.includes(r.status)).map((r) => ({ ...r }));
  }
  async countOpen() {
    return this.rows.filter(isOpenRow).length;
  }
  byKey(crmRequestId: string) {
    return this.rows.find((r) => r.crmRequestId === crmRequestId);
  }
}

interface FakeRedeem {
  voucherId: number;
  amount: number;
  memberId: string;
  eventId: number;
  voided: boolean;
}
interface FakeIssue {
  voucher: CustomerVoucherWire;
  eventId: number;
  voided: boolean;
  spent: boolean;
}

type Mode = "ok" | "unknown" | "unknown-after-effect" | "reject" | "reject404" | "throw";

// In-memory CRM with the real CRM's idempotency semantics: a redeem key is
// processed once and replays (with `voided`), a refund-issue entityId issues
// once, voids are idempotent.
export class FakeCrm implements CustomerVoucherCrm {
  balances = new Map<number, number>([[7, 1000], [8, 1000]]);
  redeems = new Map<string, FakeRedeem>();
  issues = new Map<string, FakeIssue>();
  calls: string[] = [];
  mode: Partial<Record<keyof CustomerVoucherCrm, Mode[]>> = {};
  private nextEvent = 1;
  private nextVoucher = 500;

  private take(method: keyof CustomerVoucherCrm): Mode {
    const queue = this.mode[method];
    return queue && queue.length ? queue.shift()! : "ok";
  }
  private unknown<T>(): CrmOutcome<T> {
    return { kind: "unknown", status: 0, msg: "Network Error" };
  }

  async redeem(input: Parameters<CustomerVoucherCrm["redeem"]>[0]) {
    this.calls.push(`redeem ${input.requestId}`);
    const mode = this.take("redeem");
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "unknown") return this.unknown<never>();
    if (mode === "reject") return { kind: "rejected" as const, status: 400, msg: "Customer voucher balance is insufficient" };
    if (mode === "reject404") return { kind: "rejected" as const, status: 404, msg: "Not Found" };
    const existing = this.redeems.get(input.requestId);
    if (existing) {
      return {
        kind: "ok" as const,
        result: { eventId: existing.eventId, voucherId: existing.voucherId, replayed: true, voided: existing.voided },
      };
    }
    const balance = this.balances.get(input.voucherId) ?? 0;
    if (balance < input.amount)
      return { kind: "rejected" as const, status: 400, msg: "Customer voucher balance is insufficient" };
    this.balances.set(input.voucherId, balance - input.amount);
    const record = { voucherId: input.voucherId, amount: input.amount, memberId: input.memberId, eventId: this.nextEvent++, voided: false };
    this.redeems.set(input.requestId, record);
    if (mode === "unknown-after-effect") return this.unknown<never>();
    return { kind: "ok" as const, result: { eventId: record.eventId, voucherId: record.voucherId, replayed: false, voided: false } };
  }

  async voidRedeem(input: Parameters<CustomerVoucherCrm["voidRedeem"]>[0]) {
    this.calls.push(`voidRedeem ${input.redeemRequestId}`);
    const mode = this.take("voidRedeem");
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "unknown") return this.unknown<never>();
    const redeem = this.redeems.get(input.redeemRequestId);
    if (!redeem) return { kind: "rejected" as const, status: 404, msg: "Original redeem event not found" };
    if (!redeem.voided) {
      redeem.voided = true;
      this.balances.set(redeem.voucherId, (this.balances.get(redeem.voucherId) ?? 0) + redeem.amount);
    }
    return { kind: "ok" as const, result: { eventId: this.nextEvent++ } };
  }

  async issueRefund(input: Parameters<CustomerVoucherCrm["issueRefund"]>[0]) {
    this.calls.push(`issueRefund ${input.entityId}`);
    const mode = this.take("issueRefund");
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "unknown") return this.unknown<never>();
    if (mode === "reject404") return { kind: "rejected" as const, status: 404, msg: "Not Found" };
    const existing = this.issues.get(input.entityId);
    if (existing)
      return { kind: "ok" as const, result: { voucher: existing.voucher, eventId: existing.eventId, replayed: true, voided: existing.voided } };
    const id = this.nextVoucher++;
    const voucher: CustomerVoucherWire = {
      id,
      memberId: input.memberId,
      serial: `RF-${id}`,
      kind: "REFUND",
      initAmount: input.amount,
      balance: input.amount,
      status: "ACTIVE",
      validFrom: "2026-10-08T00:00:00.000Z",
      validTo: "2026-10-15T00:00:00.000Z",
      label: `RF-${id} - Exp 26-10-15`,
    };
    const issue = { voucher, eventId: this.nextEvent++, voided: false, spent: false };
    this.issues.set(input.entityId, issue);
    if (mode === "unknown-after-effect") return this.unknown<never>();
    return { kind: "ok" as const, result: { voucher, eventId: issue.eventId, replayed: false, voided: false } };
  }

  async voidRefundIssue(input: Parameters<CustomerVoucherCrm["voidRefundIssue"]>[0]) {
    this.calls.push(`voidRefundIssue ${input.entityId}`);
    const mode = this.take("voidRefundIssue");
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "unknown") return this.unknown<never>();
    const issue = this.issues.get(input.entityId);
    if (!issue) return { kind: "rejected" as const, status: 404, msg: "Refund issue not found" };
    if (issue.spent && !issue.voided)
      return { kind: "rejected" as const, status: 409, msg: "Refund voucher already spent" };
    issue.voided = true;
    return { kind: "ok" as const, result: { eventId: this.nextEvent++ } };
  }

  async getOperation(requestId: string): Promise<CrmOutcome<CrmOperationState>> {
    this.calls.push(`getOperation ${requestId}`);
    const mode = this.take("getOperation");
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "unknown") return this.unknown();
    const redeem = this.redeems.get(requestId);
    if (redeem)
      return { kind: "ok", result: { state: redeem.voided ? "voided" : "redeemed", eventId: redeem.eventId, voucherId: redeem.voucherId, amount: redeem.amount } };
    const issue = this.issues.get(requestId);
    if (issue)
      return { kind: "ok", result: { state: issue.voided ? "issue_voided" : "issued", eventId: issue.eventId, voucherId: issue.voucher.id, amount: issue.voucher.initAmount } };
    return { kind: "ok", result: { state: "not_found", eventId: null, voucherId: null, amount: null } };
  }

  async ping(_memberId: string): Promise<CrmOutcome<true>> {
    this.calls.push("ping");
    const mode = this.take("ping");
    if (mode === "throw") throw new Error("connect ECONNREFUSED");
    if (mode === "unknown") return this.unknown();
    return { kind: "ok", result: true };
  }
}

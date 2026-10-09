import db from "../../libs/db";
import apiService, { type ApiResponse } from "../../libs/cloud.api";
import type { Prisma } from "../../generated/prisma/client";
import {
  createSweepRunner,
  isHaltingCloudFailure,
  type SweepPageResult,
  type SweepPendingStats,
  type SweepRunnerOptions,
  type SweepSource,
} from "./sweep-runner";

/**
 * Cloud sync — local POS → main api (proxy) → data-server.
 *
 *   • cloudId == null ⟺ not synced yet.
 *   • Push in `id ASC` pages (sweep-runner.ts, T-24 R-5/R-18). A repay/refund
 *     child whose original has no cloudId yet is deferred (left pending) —
 *     it no longer stops the rest of the sweep; the original is pushed first
 *     because it has the lower id.
 *   • Fire-and-forget from sale/refund/repay/shift flows and the Sync button;
 *     a trigger during a run coalesces into one rerun, and a run that ends
 *     with failures schedules a timed retry (1 → 2 → 5 → 10 min).
 *   • Main api server injects `deviceId` en route — we do NOT send it.
 */

// ────────────────────────────────────────────────────────────────
//  SALE INVOICES
// ────────────────────────────────────────────────────────────────

// Narrow projection: exactly the columns buildInvoicePayload sends.
const invoiceRowSelect = {
  index: true,
  type: true,
  itemId: true,
  name_en: true,
  name_ko: true,
  barcode: true,
  uom: true,
  taxable: true,
  isPointExcluded: true,
  unit_price_original: true,
  unit_price_discounted: true,
  unit_price_adjusted: true,
  unit_price_effective: true,
  qty: true,
  measured_weight: true,
  total: true,
  tax_amount: true,
  net: true,
  adjustments: true,
  ppMarkdownType: true,
  ppMarkdownAmount: true,
  originalInvoiceId: true,
  originalInvoiceRowId: true,
  refunded_qty: true,
  surcharge_share: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SaleInvoiceRowSelect;

const invoicePaymentSelect = {
  type: true,
  amount: true,
  entityType: true,
  entityId: true,
  entityLabel: true,
  crmEventId: true,
} satisfies Prisma.SaleInvoicePaymentSelect;

export const pendingInvoiceSelect = {
  id: true,
  companyId: true,
  serial: true,
  dayStr: true,
  type: true,
  originalInvoiceId: true,
  externalOrderId: true,
  shiftId: true,
  terminalId: true,
  userId: true,
  companyName: true,
  abn: true,
  phone: true,
  address1: true,
  address2: true,
  suburb: true,
  state: true,
  postcode: true,
  country: true,
  terminalName: true,
  userName: true,
  memberId: true,
  memberName: true,
  memberLevel: true,
  memberPhoneLast4: true,
  linesTotal: true,
  rounding: true,
  creditSurchargeAmount: true,
  lineTax: true,
  surchargeTax: true,
  total: true,
  cashChange: true,
  receiptCount: true,
  pointsEarned: true,
  pointsReversed: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  rows: { orderBy: { index: "asc" }, select: invoiceRowSelect },
  payments: { orderBy: { id: "asc" }, select: invoicePaymentSelect },
} satisfies Prisma.SaleInvoiceSelect;

export type PendingInvoice = Prisma.SaleInvoiceGetPayload<{
  select: typeof pendingInvoiceSelect;
}>;

// serial must be present — cloud DTO requires it (populated at create time
// via DocCounter, so in practice never null).
const pendingInvoiceWhere = {
  cloudId: null,
  serial: { not: null },
} satisfies Prisma.SaleInvoiceWhereInput;

export interface InvoiceSweepDeps {
  loadPage(afterId: number, limit: number): Promise<PendingInvoice[]>;
  // local id → cloudId (null = not synced) for the given originals.
  loadParentCloudIds(localIds: number[]): Promise<Map<number, number | null>>;
  push(payload: ReturnType<typeof buildInvoicePayload>): Promise<ApiResponse<{ id: number }>>;
  markSynced(localId: number, cloudId: number): Promise<void>;
  pendingStats(): Promise<SweepPendingStats>;
}

export const prismaInvoiceSweepDeps: InvoiceSweepDeps = {
  loadPage: (afterId, limit) =>
    db.saleInvoice.findMany({
      where: { ...pendingInvoiceWhere, id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
      select: pendingInvoiceSelect,
    }),
  loadParentCloudIds: async (localIds) => {
    if (localIds.length === 0) return new Map();
    const parents = await db.saleInvoice.findMany({
      where: { id: { in: localIds } },
      select: { id: true, cloudId: true },
    });
    return new Map(parents.map((p) => [p.id, p.cloudId]));
  },
  push: (payload) =>
    apiService.post<{ id: number }>("/device/sync/retail/sale-invoice", {
      data: payload,
    }),
  markSynced: async (localId, cloudId) => {
    await db.saleInvoice.update({ where: { id: localId }, data: { cloudId } });
  },
  pendingStats: async () => {
    const [count, oldest] = await Promise.all([
      db.saleInvoice.count({ where: pendingInvoiceWhere }),
      db.saleInvoice.findFirst({
        where: pendingInvoiceWhere,
        orderBy: { id: "asc" },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldestAt: oldest?.createdAt ?? null };
  },
};

export function createInvoiceSweepSource(
  deps: InvoiceSweepDeps,
): SweepSource<PendingInvoice> {
  return {
    name: "invoice",
    loadPage: deps.loadPage,
    pendingStats: deps.pendingStats,
    async processPage(rows): Promise<SweepPageResult> {
      const result: SweepPageResult = { done: 0, deferred: 0, failed: 0, halted: false };
      const parentIds = [
        ...new Set(
          rows
            .map((r) => r.originalInvoiceId)
            .filter((id): id is number => id != null),
        ),
      ];
      // Originals pushed earlier in this page are added as they succeed.
      const cloudIdOf = await deps.loadParentCloudIds(parentIds);

      for (const inv of rows) {
        let originalCloudId: number | null = null;
        if (inv.originalInvoiceId != null) {
          const parentCloudId = cloudIdOf.get(inv.originalInvoiceId) ?? null;
          if (parentCloudId == null) {
            result.deferred++; // parent not synced yet — later run
            continue;
          }
          originalCloudId = parentCloudId;
        }

        const res = await deps.push(buildInvoicePayload(inv, originalCloudId));
        if (!res.ok || !res.result?.id) {
          result.failed++;
          console.error(`[cloud.sync] invoice ${inv.id} push failed: ${res.status ?? "-"} ${res.msg}`);
          if (isHaltingCloudFailure(res)) {
            result.halted = true;
            return result;
          }
          continue;
        }

        await deps.markSynced(inv.id, res.result.id);
        cloudIdOf.set(inv.id, res.result.id);
        result.done++;
      }
      return result;
    },
  };
}

// ────────────────────────────────────────────────────────────────
//  TERMINAL SHIFTS (closed only)
// ────────────────────────────────────────────────────────────────

const pendingShiftWhere = {
  cloudId: null,
  closedAt: { not: null },
} satisfies Prisma.TerminalShiftWhereInput;

export const pendingShiftSelect = {
  id: true,
  companyId: true,
  terminalId: true,
  terminal: { select: { name: true } },
  dayStr: true,
  openedUserId: true,
  openedUser: true,
  openedAt: true,
  openedNote: true,
  closedUserId: true,
  closedUser: true,
  closedAt: true,
  closedNote: true,
  startedCash: true,
  endedCashExpected: true,
  endedCashActual: true,
  salesCash: true,
  salesCredit: true,
  salesUserVoucher: true,
  salesCustomerVoucher: true,
  salesGiftcard: true,
  salesLinesTotal: true,
  salesRounding: true,
  salesCount: true,
  repayCount: true,
  salesCreditSurcharge: true,
  salesTax: true,
  refundsCash: true,
  refundsCredit: true,
  refundsUserVoucher: true,
  refundsCustomerVoucher: true,
  refundsGiftcard: true,
  refundsLinesTotal: true,
  refundsRounding: true,
  refundsCount: true,
  refundsCreditSurcharge: true,
  refundsTax: true,
  spendCount: true,
  spendRetailValue: true,
  totalCashIn: true,
  totalCashOut: true,
} satisfies Prisma.TerminalShiftSelect;

export type PendingShift = Prisma.TerminalShiftGetPayload<{
  select: typeof pendingShiftSelect;
}>;

export interface ShiftSweepDeps {
  loadPage(afterId: number, limit: number): Promise<PendingShift[]>;
  push(payload: ReturnType<typeof buildShiftPayload>): Promise<ApiResponse<{ id: number }>>;
  markSynced(localId: number, cloudId: number): Promise<void>;
  pendingStats(): Promise<SweepPendingStats>;
}

export const prismaShiftSweepDeps: ShiftSweepDeps = {
  loadPage: (afterId, limit) =>
    db.terminalShift.findMany({
      where: { ...pendingShiftWhere, id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
      select: pendingShiftSelect,
    }),
  push: (payload) =>
    apiService.post<{ id: number }>("/device/sync/retail/terminal-shift", {
      data: payload,
    }),
  markSynced: async (localId, cloudId) => {
    await db.terminalShift.update({ where: { id: localId }, data: { cloudId } });
  },
  pendingStats: async () => {
    const [count, oldest] = await Promise.all([
      db.terminalShift.count({ where: pendingShiftWhere }),
      db.terminalShift.findFirst({
        where: pendingShiftWhere,
        orderBy: { id: "asc" },
        select: { closedAt: true },
      }),
    ]);
    return { count, oldestAt: oldest?.closedAt ?? null };
  },
};

export function createShiftSweepSource(
  deps: ShiftSweepDeps,
): SweepSource<PendingShift> {
  return {
    name: "shift",
    loadPage: deps.loadPage,
    pendingStats: deps.pendingStats,
    async processPage(rows): Promise<SweepPageResult> {
      const result: SweepPageResult = { done: 0, deferred: 0, failed: 0, halted: false };
      for (const shift of rows) {
        const res = await deps.push(buildShiftPayload(shift));
        if (!res.ok || !res.result?.id) {
          result.failed++;
          console.error(`[cloud.sync] shift ${shift.id} push failed: ${res.status ?? "-"} ${res.msg}`);
          if (isHaltingCloudFailure(res)) {
            result.halted = true;
            return result;
          }
          continue;
        }
        await deps.markSynced(shift.id, res.result.id);
        result.done++;
      }
      return result;
    },
  };
}

// ────────────────────────────────────────────────────────────────
//  RUNNERS (module singletons)
// ────────────────────────────────────────────────────────────────

export function createInvoiceSweepRunner(
  deps: InvoiceSweepDeps = prismaInvoiceSweepDeps,
  options?: SweepRunnerOptions,
) {
  return createSweepRunner(createInvoiceSweepSource(deps), options);
}

export function createShiftSweepRunner(
  deps: ShiftSweepDeps = prismaShiftSweepDeps,
  options?: SweepRunnerOptions,
) {
  return createSweepRunner(createShiftSweepSource(deps), options);
}

const invoiceSweep = createInvoiceSweepRunner();
const shiftSweep = createShiftSweepRunner();

export function triggerSyncAllSaleInvoices() {
  // fire-and-forget — caller does not await; the runner never rejects.
  void invoiceSweep.trigger();
}

export function triggerSyncAllShifts() {
  void shiftSweep.trigger();
}

// ────────────────────────────────────────────────────────────────
//  PAYLOAD BUILDERS
// ────────────────────────────────────────────────────────────────

export function buildInvoicePayload(
  inv: PendingInvoice,
  originalCloudId: number | null,
) {
  return {
    localId: inv.id,
    companyId: inv.companyId,
    serial: inv.serial,
    dayStr: inv.dayStr,
    type: inv.type,

    originalInvoiceId: originalCloudId,

    // S3 — C&C 주문 연계 (crm RetailOrder.id 문자열). api-server 업싱크 DTO
    // 필드명과 동일해야 한다 (스펙 §5 — 어드민/리포트의 주문↔인보이스 역추적).
    externalOrderId: inv.externalOrderId ?? null,

    localShiftId: inv.shiftId,
    terminalId: inv.terminalId,
    userId: inv.userId,

    companyName: inv.companyName,
    abn: inv.abn,
    phone: inv.phone,
    address1: inv.address1,
    address2: inv.address2,
    suburb: inv.suburb,
    state: inv.state,
    postcode: inv.postcode,
    country: inv.country,

    terminalName: inv.terminalName,
    userName: inv.userName,

    memberId: inv.memberId,
    memberName: inv.memberName,
    memberLevel: inv.memberLevel,
    memberPhoneLast4: inv.memberPhoneLast4,

    linesTotal: inv.linesTotal,
    rounding: inv.rounding,
    creditSurchargeAmount: inv.creditSurchargeAmount,
    lineTax: inv.lineTax,
    surchargeTax: inv.surchargeTax,
    total: inv.total,
    cashChange: inv.cashChange,

    receiptCount: inv.receiptCount,
    pointsEarned: inv.pointsEarned,
    pointsReversed: inv.pointsReversed,
    note: inv.note,

    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,

    rows: inv.rows.map((r) => ({
      index: r.index,
      type: r.type,
      itemId: r.itemId,
      name_en: r.name_en,
      name_ko: r.name_ko,
      barcode: r.barcode,
      uom: r.uom,
      taxable: r.taxable,
      isPointExcluded: r.isPointExcluded,
      unit_price_original: r.unit_price_original,
      unit_price_discounted: r.unit_price_discounted,
      unit_price_adjusted: r.unit_price_adjusted,
      unit_price_effective: r.unit_price_effective,
      qty: r.qty,
      measured_weight: r.measured_weight,
      total: r.total,
      tax_amount: r.tax_amount,
      net: r.net,
      adjustments: r.adjustments,
      ppMarkdownType: r.ppMarkdownType,
      ppMarkdownAmount: r.ppMarkdownAmount,
      // refund linkage — row-level original ids are POS-local; data-server
      // stores them as-is (not cloud-id). Analytics across devices can
      // resolve later via (deviceId, localId) join if needed.
      originalInvoiceId: r.originalInvoiceId,
      originalInvoiceRowId: r.originalInvoiceRowId,
      refunded_qty: r.refunded_qty,
      surcharge_share: r.surcharge_share,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),

    payments: inv.payments.map((p) => ({
      type: p.type,
      amount: p.amount,
      entityType: p.entityType,
      entityId: p.entityId,
      entityLabel: p.entityLabel,
      // T-25 (V-7 / O-17): CRM event id of a customer-voucher tender (else
      // null). api-server stores it and forwards it to CRM with the invoice
      // push, which links the voucher event to this receipt by it.
      crmEventId:
        p.type === "VOUCHER" && p.entityType === "customer-voucher" ? p.crmEventId : null,
    })),
  };
}

export function buildShiftPayload(shift: PendingShift) {
  return {
    localId: shift.id,
    companyId: shift.companyId,
    terminalId: shift.terminalId,
    terminal: shift.terminal?.name ?? "Terminal",
    dayStr: shift.dayStr,

    openedUserId: shift.openedUserId,
    openedUser: shift.openedUser,
    openedAt: shift.openedAt,
    openedNote: shift.openedNote,
    closedUserId: shift.closedUserId,
    closedUser: shift.closedUser,
    closedAt: shift.closedAt,
    closedNote: shift.closedNote,

    startedCash: shift.startedCash,
    endedCashExpected: shift.endedCashExpected,
    endedCashActual: shift.endedCashActual,

    salesCash: shift.salesCash,
    salesCredit: shift.salesCredit,
    salesUserVoucher: shift.salesUserVoucher,
    salesCustomerVoucher: shift.salesCustomerVoucher,
    salesGiftcard: shift.salesGiftcard,

    salesLinesTotal: shift.salesLinesTotal,
    salesRounding: shift.salesRounding,
    salesCount: shift.salesCount,
    repayCount: shift.repayCount,

    salesCreditSurcharge: shift.salesCreditSurcharge,
    salesTax: shift.salesTax,

    refundsCash: shift.refundsCash,
    refundsCredit: shift.refundsCredit,
    refundsUserVoucher: shift.refundsUserVoucher,
    refundsCustomerVoucher: shift.refundsCustomerVoucher,
    refundsGiftcard: shift.refundsGiftcard,

    refundsLinesTotal: shift.refundsLinesTotal,
    refundsRounding: shift.refundsRounding,
    refundsCount: shift.refundsCount,

    refundsCreditSurcharge: shift.refundsCreditSurcharge,
    refundsTax: shift.refundsTax,

    spendCount: shift.spendCount,
    spendRetailValue: shift.spendRetailValue,

    totalCashIn: shift.totalCashIn,
    totalCashOut: shift.totalCashOut,
  };
}

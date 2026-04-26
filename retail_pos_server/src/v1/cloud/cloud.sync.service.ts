import db from "../../libs/db";
import apiService from "../../libs/cloud.api";

/**
 * Cloud sync — local POS → main api (proxy) → data-server.
 *
 * Design (intentionally simple):
 *   • cloudId == null ⟺ not synced yet.
 *   • Push in `id ASC` order so repay/refund children naturally follow
 *     their original SALE (which must have a cloudId before child push).
 *   • Fire-and-forget from sale/refund/repay/shift flows — failures leave
 *     rows as cloudId=null for the next sweep.
 *   • Main api server injects `deviceId` en route — we do NOT send it.
 *
 * Concurrency guard — a single module-level flag keeps overlapping sweeps
 * from racing. Triggers hit `triggerSyncAllSaleInvoices()` which is a
 * no-op when a sweep is already in flight.
 */

let invoiceSweepRunning = false;
let shiftSweepRunning = false;

// ────────────────────────────────────────────────────────────────
//  SALE INVOICES
// ────────────────────────────────────────────────────────────────

export async function syncAllSaleInvoices(): Promise<{
  pushed: number;
  failed: number;
}> {
  if (invoiceSweepRunning) return { pushed: 0, failed: 0 };
  invoiceSweepRunning = true;

  let pushed = 0;
  let failed = 0;

  try {
    const pending = await db.saleInvoice.findMany({
      // serial must be present — cloud DTO requires it (populated at create
      // time via DocCounter, so in practice never null).
      where: { cloudId: null, serial: { not: null } },
      orderBy: { id: "asc" },
      include: {
        rows: { orderBy: { index: "asc" } },
        payments: { orderBy: { id: "asc" } },
      },
    });

    for (const inv of pending) {
      // Resolve originalInvoiceId → cloud id. If the local original hasn't
      // synced yet, break — later sweep will pick it up.
      let originalCloudId: number | null = null;
      if (inv.originalInvoiceId != null) {
        const parent = await db.saleInvoice.findUnique({
          where: { id: inv.originalInvoiceId },
          select: { cloudId: true },
        });
        if (!parent?.cloudId) break; // parent not synced — defer
        originalCloudId = parent.cloudId;
      }

      const payload = buildInvoicePayload(inv, originalCloudId);
      const res = await apiService.post<{ id: number }>(
        "/device/sync/retail/sale-invoice",
        { data: payload },
      );

      if (!res.ok || !res.result?.id) {
        failed++;
        console.error(`[cloud.sync] invoice ${inv.id} push failed: ${res.msg}`);
        break; // stop sweep — follow-ups likely have dependency on this one
      }

      await db.saleInvoice.update({
        where: { id: inv.id },
        data: { cloudId: res.result.id },
      });
      pushed++;
    }
  } finally {
    invoiceSweepRunning = false;
  }

  return { pushed, failed };
}

export function triggerSyncAllSaleInvoices() {
  // fire-and-forget — caller does not await
  syncAllSaleInvoices().catch((e) => {
    console.error("[cloud.sync] syncAllSaleInvoices threw:", e);
  });
}

// ────────────────────────────────────────────────────────────────
//  TERMINAL SHIFTS (closed only)
// ────────────────────────────────────────────────────────────────

export async function syncAllShifts(): Promise<{
  pushed: number;
  failed: number;
}> {
  if (shiftSweepRunning) return { pushed: 0, failed: 0 };
  shiftSweepRunning = true;

  let pushed = 0;
  let failed = 0;

  try {
    const pending = await db.terminalShift.findMany({
      where: { cloudId: null, closedAt: { not: null } },
      include: {
        terminal: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    for (const shift of pending) {
      const payload = buildShiftPayload(shift);
      const res = await apiService.post<{ id: number }>(
        "/device/sync/retail/terminal-shift",
        { data: payload },
      );

      if (!res.ok || !res.result?.id) {
        failed++;
        console.error(`[cloud.sync] shift ${shift.id} push failed: ${res.msg}`);
        break;
      }

      await db.terminalShift.update({
        where: { id: shift.id },
        data: { cloudId: res.result.id },
      });
      pushed++;
    }
  } finally {
    shiftSweepRunning = false;
  }

  return { pushed, failed };
}

export function triggerSyncAllShifts() {
  syncAllShifts().catch((e) => {
    console.error("[cloud.sync] syncAllShifts threw:", e);
  });
}

// ────────────────────────────────────────────────────────────────
//  PAYLOAD BUILDERS
// ────────────────────────────────────────────────────────────────

function buildInvoicePayload(
  inv: any, // SaleInvoice & { rows: SaleInvoiceRow[]; payments: SaleInvoicePayment[] }
  originalCloudId: number | null,
) {
  return {
    localId: inv.id,
    companyId: inv.companyId,
    serial: inv.serial,
    dayStr: inv.dayStr,
    type: inv.type,

    originalInvoiceId: originalCloudId,

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
    note: inv.note,

    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,

    rows: inv.rows.map((r: any) => ({
      index: r.index,
      type: r.type,
      itemId: r.itemId,
      name_en: r.name_en,
      name_ko: r.name_ko,
      barcode: r.barcode,
      uom: r.uom,
      taxable: r.taxable,
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

    payments: inv.payments.map((p: any) => ({
      type: p.type,
      amount: p.amount,
      entityType: p.entityType,
      entityId: p.entityId,
      entityLabel: p.entityLabel,
    })),
  };
}

function buildShiftPayload(shift: any) {
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

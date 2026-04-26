import { Company, Terminal, User } from "../../generated/prisma/client";
import momentAU from "../../libs/date-utils";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { TerminalShiftModel } from "../../generated/prisma/models";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "../cloud/cloud.sync.service";

type OpenShiftDTO = {
  openedNote: string;
  cashInDrawer: number;
  getBackItemIds: number[];
  getBackOptionIds: number[];
  isPublicHoliday: boolean;
};

export async function openTerminalShiftService(
  company: Company,
  terminal: Terminal,
  user: User,
  dto: OpenShiftDTO,
) {
  try {
    if (!company) throw new NotFoundException("Company not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    const exist = await db.terminalShift.findFirst({
      where: {
        terminalId: terminal.id,
        closedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (exist) throw new BadRequestException("Shift already opened");

    const now = momentAU(new Date());

    const newShift = await db.terminalShift.create({
      data: {
        companyId: company.id,
        terminalId: terminal.id,

        dayStr: now.format("ddd"),

        openedUserId: user.id,
        openedUser: user.name,
        openedAt: now.toDate(),
        openedNote: dto.openedNote || null,
        startedCash: dto.cashInDrawer,
      },
      select: {
        id: true,
      },
    });

    return {
      ok: true,
      result: newShift.id,
      msg: "Terminal shift opened successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("openTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}

export async function getCurrentTerminalShiftService(terminalId: number) {
  try {
    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminalId,
        closedAt: null,
      },
    });

    return { ok: true, result: shift || null, msg: "Success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getCurrentTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}

export async function getShiftByIdService(shiftId: number) {
  try {
    const shift = await db.terminalShift.findUnique({
      where: { id: shiftId },
    });
    if (!shift) throw new NotFoundException("Shift not found");
    return { ok: true, result: shift, msg: "Success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getShiftByIdService error:", e);
    throw new InternalServerException();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Shift aggregate (D-34) — source-of-truth SUM 재집계
//
// 증분 캐시 (sale create 시 shift.salesCash +=) 는 사용하지 않음. Close 또는
// preview 시 invoices / payments / cashio 테이블에서 직접 SUM 하여 드리프트 없는
// 집계를 보장.
//
// Preview 와 실제 close 가 같은 helper 를 공유 → cashier 가 preview 에서 본
// 숫자 ≡ 실제 close 된 숫자 (사이에 새 거래 없을 때).
// ══════════════════════════════════════════════════════════════════════════════

export interface ShiftAggregate {
  // Sales (tender 별, cents)
  salesCash: number;
  salesCredit: number;
  salesUserVoucher: number;
  salesCustomerVoucher: number;
  salesGiftcard: number;
  // Sales (gross items / rounding / counts)
  salesLinesTotal: number;
  salesRounding: number;
  salesCount: number;
  repayCount: number; // SALE with originalInvoiceId != null
  // Sales (analytical)
  salesCreditSurcharge: number;
  salesTax: number; // lineTax + surchargeTax
  // Refunds (tender)
  refundsCash: number;
  refundsCredit: number;
  refundsUserVoucher: number;
  refundsCustomerVoucher: number;
  refundsGiftcard: number;
  // Refunds (gross items / rounding / counts)
  refundsLinesTotal: number;
  refundsRounding: number;
  refundsCount: number;
  // Refunds (analytical)
  refundsCreditSurcharge: number;
  refundsTax: number;
  // SPEND
  spendCount: number;
  spendRetailValue: number;
  // Cash drawer movement
  totalCashIn: number;
  totalCashOut: number;
}

const QTY_SCALE = 1000;

export async function aggregateShift(shiftId: number): Promise<ShiftAggregate> {
  // 1. Invoices groupBy type — linesTotal / rounding / surcharge / tax / count
  const invoiceGroups = await db.saleInvoice.groupBy({
    by: ["type"],
    where: { shiftId },
    _sum: {
      linesTotal: true,
      rounding: true,
      creditSurchargeAmount: true,
      lineTax: true,
      surchargeTax: true,
    },
    _count: { _all: true },
  });
  const findByType = (t: "SALE" | "REFUND" | "SPEND") =>
    invoiceGroups.find((g) => g.type === t);
  const saleInv = findByType("SALE");
  const refundInv = findByType("REFUND");
  const spendInv = findByType("SPEND");

  const salesLinesTotal = saleInv?._sum.linesTotal ?? 0;
  const salesRounding = saleInv?._sum.rounding ?? 0;
  const salesCreditSurcharge = saleInv?._sum.creditSurchargeAmount ?? 0;
  const salesLineTax = saleInv?._sum.lineTax ?? 0;
  const salesSurchargeTax = saleInv?._sum.surchargeTax ?? 0;
  const salesTax = salesLineTax + salesSurchargeTax;
  const salesCount = saleInv?._count._all ?? 0;

  const refundsLinesTotal = refundInv?._sum.linesTotal ?? 0;
  const refundsRounding = refundInv?._sum.rounding ?? 0;
  const refundsCreditSurcharge = refundInv?._sum.creditSurchargeAmount ?? 0;
  const refundsLineTax = refundInv?._sum.lineTax ?? 0;
  const refundsSurchargeTax = refundInv?._sum.surchargeTax ?? 0;
  const refundsTax = refundsLineTax + refundsSurchargeTax;
  const refundsCount = refundInv?._count._all ?? 0;

  const spendCount = spendInv?._count._all ?? 0;

  // 2. Repay count — SALE with originalInvoiceId (repay 로 생성된 새 SALE).
  const repayCount = await db.saleInvoice.count({
    where: {
      shiftId,
      type: "SALE",
      originalInvoiceId: { not: null },
    },
  });

  // 3. Payments — SALE / REFUND 각각 tender (+ voucher entityType) 별 SUM.
  const salePayments = await db.saleInvoicePayment.groupBy({
    by: ["type", "entityType"],
    where: { invoice: { shiftId, type: "SALE" } },
    _sum: { amount: true },
  });
  const refundPayments = await db.saleInvoicePayment.groupBy({
    by: ["type", "entityType"],
    where: { invoice: { shiftId, type: "REFUND" } },
    _sum: { amount: true },
  });

  function splitTender(
    groups: Array<{
      type: string;
      entityType: string | null;
      _sum: { amount: number | null };
    }>,
  ) {
    let cash = 0;
    let credit = 0;
    let giftcard = 0;
    let userVoucher = 0;
    let customerVoucher = 0;
    for (const g of groups) {
      const amt = g._sum.amount ?? 0;
      if (g.type === "CASH") cash += amt;
      else if (g.type === "CREDIT") credit += amt;
      else if (g.type === "GIFTCARD") giftcard += amt;
      else if (g.type === "VOUCHER") {
        if (g.entityType === "user-voucher") userVoucher += amt;
        else if (g.entityType === "customer-voucher") customerVoucher += amt;
      }
    }
    return { cash, credit, giftcard, userVoucher, customerVoucher };
  }
  const saleTender = splitTender(salePayments);
  const refundTender = splitTender(refundPayments);

  // 4. CashInOut groupBy type
  const cashIoGroups = await db.cashInOut.groupBy({
    by: ["type"],
    where: { shiftId },
    _sum: { amount: true },
  });
  const totalCashIn =
    cashIoGroups.find((g) => g.type === "in")?._sum.amount ?? 0;
  const totalCashOut =
    cashIoGroups.find((g) => g.type === "out")?._sum.amount ?? 0;

  // 5. SPEND retail value — Σ(row.unit_price_original × row.qty / QTY_SCALE)
  //    Prisma groupBy 는 computed field 지원 안 해서 row fetch 후 JS 로 합산.
  //    SPEND 이 있을 때만 수행 (대개 shift 당 0~few 개).
  let spendRetailValue = 0;
  if (spendCount > 0) {
    const spendRows = await db.saleInvoiceRow.findMany({
      where: { invoice: { shiftId, type: "SPEND" } },
      select: { unit_price_original: true, qty: true },
    });
    for (const r of spendRows) {
      spendRetailValue += Math.round(
        (r.unit_price_original * r.qty) / QTY_SCALE,
      );
    }
  }

  return {
    salesCash: saleTender.cash,
    salesCredit: saleTender.credit,
    salesUserVoucher: saleTender.userVoucher,
    salesCustomerVoucher: saleTender.customerVoucher,
    salesGiftcard: saleTender.giftcard,
    salesLinesTotal,
    salesRounding,
    salesCount,
    repayCount,
    salesCreditSurcharge,
    salesTax,
    refundsCash: refundTender.cash,
    refundsCredit: refundTender.credit,
    refundsUserVoucher: refundTender.userVoucher,
    refundsCustomerVoucher: refundTender.customerVoucher,
    refundsGiftcard: refundTender.giftcard,
    refundsLinesTotal,
    refundsRounding,
    refundsCount,
    refundsCreditSurcharge,
    refundsTax,
    spendCount,
    spendRetailValue,
    totalCashIn,
    totalCashOut,
  };
}

// Expected cash 계산 — shift.startedCash + 매출현금 - 환불현금 + cashIn - cashOut.
// Rounding 은 이미 salesCash (= payment.amount, 즉 cashApplied = 라운드 후) 에
// 반영돼 있어 더할 필요 없음.
function computeExpectedCash(
  startedCash: number,
  aggregate: ShiftAggregate,
): number {
  return (
    startedCash +
    aggregate.salesCash -
    aggregate.refundsCash +
    aggregate.totalCashIn -
    aggregate.totalCashOut
  );
}

// ── Preview (가정산) ────────────────────────────────────────────────────────
// Write 없음. CloseShiftScreen 진입 시 cashier 에게 기대 현금 / tender 합계를
// 보여주기 위해 호출. `aggregateShift` 와 expected cash 반환.
export interface ShiftClosePreviewResult {
  shift: TerminalShiftModel;
  aggregate: ShiftAggregate;
  endedCashExpected: number;
}

export async function previewCloseShiftService(shift: TerminalShiftModel) {
  try {
    const aggregate = await aggregateShift(shift.id);
    const endedCashExpected = computeExpectedCash(shift.startedCash, aggregate);
    return {
      ok: true,
      result: {
        shift,
        aggregate,
        endedCashExpected,
      } satisfies ShiftClosePreviewResult,
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("previewCloseShiftService error:", e);
    throw new InternalServerException();
  }
}

// ── Close (실제 마감) ───────────────────────────────────────────────────────
// Client 는 { closedNote, endedCashActual } 만 보냄. 모든 집계는 서버가
// aggregateShift 로 재계산해서 shift record 에 write + closedAt 세팅.
// Drift / tampering 방지.
export interface CloseShiftDTO {
  closedNote?: string;
  endedCashActual: number;
}

export async function closeTerminalShiftService(
  terminal: Terminal,
  user: User,
  dto: CloseShiftDTO,
) {
  try {
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");
    if (!Number.isFinite(dto.endedCashActual) || dto.endedCashActual < 0)
      throw new BadRequestException("endedCashActual must be >= 0");

    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminal.id,
        closedAt: null,
      },
    });
    if (!shift) throw new NotFoundException("No open shift found");

    const aggregate = await aggregateShift(shift.id);
    const endedCashExpected = computeExpectedCash(shift.startedCash, aggregate);

    const now = momentAU(new Date());

    const updated = await db.terminalShift.update({
      where: { id: shift.id },
      data: {
        closedUserId: user.id,
        closedUser: user.name,
        closedAt: now.toDate(),
        closedNote: dto.closedNote?.trim() || null,
        endedCashExpected,
        endedCashActual: dto.endedCashActual,
        ...aggregate,
      },
    });

    // Push any outstanding invoices first (so shift push reflects a consistent
    // cloud view), then push the shift itself.
    triggerSyncAllSaleInvoices();
    triggerSyncAllShifts();

    return {
      ok: true,
      result: updated,
      msg: "Terminal shift closed successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("closeTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}

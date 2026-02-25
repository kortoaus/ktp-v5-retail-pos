import { TerminalShift } from "../../generated/prisma/browser";
import { Company, Terminal, User } from "../../generated/prisma/client";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { numberifySaleInvoice } from "../../libs/decimal-utils";
import { Decimal } from "@prisma/client/runtime/index-browser";

type RefundRowDto = {
  type: string;
  itemId: number;
  name_en: string;
  name_ko: string;
  taxable: boolean;
  uom: string;
  barcode: string;
  index: number;
  barcodePrice: number | null;
  unit_price_original: number;
  unit_price_discounted: number | null;
  unit_price_adjusted: number | null;
  unit_price_effective: number;
  qty: number;
  measured_weight: number | null;
  subtotal: number;
  total: number;
  original_invoice_id: number;
  original_invoice_row_id: number;
  adjustments: string[];
  tax_amount_included: number;
};

type CreateRefundInvoiceDto = {
  original_invoice_id: number;
  subtotal: number;
  documentDiscountAmount: number;
  creditSurchargeAmount: number;
  rounding: number;
  total: number;
  taxAmount: number;
  cashPaid: number;
  cashChange: number;
  creditPaid: number;
  totalDiscountAmount: number;
  memberId: string | null;
  memberLevel: number | null;
  rows: RefundRowDto[];
  payments: { type: string; amount: number; surcharge: number }[];
};

export async function createRefundInvoiceService(
  company: Company,
  terminal: Terminal,
  shift: TerminalShift,
  user: User,
  dto: CreateRefundInvoiceDto,
) {
  try {
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!company) throw new NotFoundException("Company not found");

    if (!dto.original_invoice_id) {
      throw new BadRequestException("original_invoice_id is required");
    }
    if (!dto.rows || dto.rows.length === 0) {
      throw new BadRequestException("At least one refund row is required");
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Fetch original invoice
      const originalInvoice = await tx.saleInvoice.findFirst({
        where: { id: dto.original_invoice_id, type: "sale" },
        include: { rows: true, payments: true },
      });
      if (!originalInvoice) {
        throw new NotFoundException("Original sale invoice not found");
      }

      // 2. Fetch all existing refunds for this invoice
      const existingRefunds = await tx.saleInvoice.findMany({
        where: { type: "refund", original_invoice_id: originalInvoice.id },
        include: { rows: true, payments: true },
      });
      const existingRefundRows = existingRefunds.flatMap((r) => r.rows);

      // 3. Validate each row: qty does not exceed remaining
      for (const row of dto.rows) {
        const originalRow = originalInvoice.rows.find(
          (r) => r.id === row.original_invoice_row_id,
        );
        if (!originalRow) {
          throw new BadRequestException(
            `Original row ${row.original_invoice_row_id} not found on invoice`,
          );
        }

        const alreadyRefundedQty = existingRefundRows
          .filter((r) => r.original_invoice_row_id === originalRow.id)
          .reduce((acc, r) => acc.plus(r.qty), new Decimal(0));

        const remainingQty = originalRow.qty.minus(alreadyRefundedQty);
        if (new Decimal(row.qty).gt(remainingQty)) {
          throw new BadRequestException(
            `Row ${row.original_invoice_row_id}: refund qty ${row.qty} exceeds remaining ${remainingQty.toNumber()}`,
          );
        }
      }

      // 4. Validate payment caps
      const originalCashPaid = originalInvoice.payments
        .filter((p) => p.type === "cash")
        .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
      const originalCreditPaid = originalInvoice.payments
        .filter((p) => p.type === "credit")
        .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));

      const alreadyRefundedCash = existingRefunds
        .flatMap((r) => r.payments)
        .filter((p) => p.type === "cash")
        .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
      const alreadyRefundedCredit = existingRefunds
        .flatMap((r) => r.payments)
        .filter((p) => p.type === "credit")
        .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));

      const remainingCashCap = originalCashPaid.minus(alreadyRefundedCash);
      const remainingCreditCap = originalCreditPaid.minus(
        alreadyRefundedCredit,
      );

      if (new Decimal(dto.cashPaid).gt(remainingCashCap)) {
        throw new BadRequestException(
          `Cash refund $${dto.cashPaid} exceeds remaining cash cap $${remainingCashCap.toNumber()}`,
        );
      }
      if (new Decimal(dto.creditPaid).gt(remainingCreditCap)) {
        throw new BadRequestException(
          `Credit refund $${dto.creditPaid} exceeds remaining credit cap $${remainingCreditCap.toNumber()}`,
        );
      }

      // 5. Create refund invoice
      const invoice = await tx.saleInvoice.create({
        data: {
          type: "refund",
          original_invoice_id: originalInvoice.id,
          original_invoice_serialNumber: originalInvoice.serialNumber,
          companyId: company.id,
          companyName: company.name,
          abn: company.abn,
          address1: company.address1,
          address2: company.address2,
          suburb: company.suburb,
          state: company.state,
          postcode: company.postcode,
          country: company.country,
          phone: company.phone,
          email: company.email,
          website: company.website,
          memberId: dto.memberId,
          memberLevel: dto.memberLevel,
          terminalId: terminal.id,
          shiftId: shift.id,
          userId: user.id,
          subtotal: dto.subtotal,
          documentDiscountAmount: dto.documentDiscountAmount,
          creditSurchargeAmount: dto.creditSurchargeAmount,
          rounding: dto.rounding,
          total: dto.total,
          taxAmount: dto.taxAmount,
          cashPaid: dto.cashPaid,
          cashChange: dto.cashChange,
          creditPaid: dto.creditPaid,
          totalDiscountAmount: dto.totalDiscountAmount,
          rows: {
            create: dto.rows.map((row) => ({
              type: row.type,
              itemId: row.itemId,
              name_en: row.name_en,
              name_ko: row.name_ko,
              taxable: row.taxable,
              uom: row.uom,
              barcode: row.barcode,
              index: row.index,
              barcodePrice: row.barcodePrice,
              unit_price_original: row.unit_price_original,
              unit_price_discounted: row.unit_price_discounted,
              unit_price_adjusted: row.unit_price_adjusted,
              unit_price_effective: row.unit_price_effective,
              qty: row.qty,
              measured_weight: row.measured_weight,
              subtotal: row.subtotal,
              total: row.total,
              original_invoice_id: row.original_invoice_id,
              original_invoice_row_id: row.original_invoice_row_id,
              adjustments: row.adjustments,
              tax_amount_included: row.tax_amount_included,
            })),
          },
          payments: {
            create: dto.payments.map((p) => ({
              type: p.type,
              amount: p.amount,
              surcharge: p.surcharge,
            })),
          },
        },
        select: { id: true },
      });

      // 6. Serial number
      const serialNumber = `${company.id}-${shift.id}-${terminal.id}-${invoice.id}`;
      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { serialNumber },
      });

      // 7. Update shift refund totals
      const cashPaidCents = Math.round(dto.cashPaid * 100);
      const creditPaidCents = Math.round(dto.creditPaid * 100);
      await tx.terminalShift.update({
        where: { id: shift.id },
        data: {
          refundsCash: { increment: cashPaidCents },
          refundsCredit: { increment: creditPaidCents },
        },
      });

      return invoice;
    });

    return {
      ok: true,
      msg: "Refund invoice created",
      result: { id: result.id },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createRefundInvoiceService error:", e);
    throw new InternalServerException();
  }
}

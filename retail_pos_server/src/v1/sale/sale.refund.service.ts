import { StoreSetting, TerminalShift } from "../../generated/prisma/browser";
import { Company, Terminal, User } from "../../generated/prisma/client";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { saleInvoiceSyncService } from "../cloud/cloud.sync.service";

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
  discount_amount: number;
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
  voucherPaid: number;
  totalDiscountAmount: number;
  memberId: string | null;
  memberLevel: number | null;
  rows: RefundRowDto[];
  payments: {
    type: string;
    amount: number;
    surcharge: number;
    entityType?: string;
    entityId?: number;
  }[];
};

export async function createRefundInvoiceService(
  company: Company,
  storeSetting: StoreSetting,
  terminal: Terminal,
  shift: TerminalShift,
  user: User,
  dto: CreateRefundInvoiceDto,
) {
  try {
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!company) throw new NotFoundException("Company not found");
    if (!storeSetting) throw new NotFoundException("Store setting not found");
    if (!dto.original_invoice_id) {
      throw new BadRequestException("original_invoice_id is required");
    }
    if (!dto.rows || dto.rows.length === 0) {
      throw new BadRequestException("At least one refund row is required");
    }

    const result = await db.$transaction(async (tx) => {
      const originalInvoice = await tx.saleInvoice.findFirst({
        where: { id: dto.original_invoice_id, type: "sale" },
        include: { rows: true, payments: true },
      });
      if (!originalInvoice) {
        throw new NotFoundException("Original sale invoice not found");
      }

      const existingRefunds = await tx.saleInvoice.findMany({
        where: { type: "refund", original_invoice_id: originalInvoice.id },
        include: { rows: true, payments: true },
      });
      const existingRefundRows = existingRefunds.flatMap((r) => r.rows);

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
          .reduce((acc, r) => acc + r.qty, 0);

        const remainingQty = originalRow.qty - alreadyRefundedQty;
        if (row.qty > remainingQty) {
          throw new BadRequestException(
            `Row ${row.original_invoice_row_id}: refund qty ${row.qty} exceeds remaining ${remainingQty}`,
          );
        }
      }

      const originalCashPaid = originalInvoice.payments
        .filter((p) => p.type === "cash")
        .reduce((acc, p) => acc + p.amount, 0);
      const originalCreditPaid = originalInvoice.payments
        .filter((p) => p.type === "credit")
        .reduce((acc, p) => acc + p.amount, 0);

      const alreadyRefundedCash = existingRefunds
        .flatMap((r) => r.payments)
        .filter((p) => p.type === "cash")
        .reduce((acc, p) => acc + p.amount, 0);
      const alreadyRefundedCredit = existingRefunds
        .flatMap((r) => r.payments)
        .filter((p) => p.type === "credit")
        .reduce((acc, p) => acc + p.amount, 0);

      const remainingCashCap = originalCashPaid - alreadyRefundedCash;
      const remainingCreditCap = originalCreditPaid - alreadyRefundedCredit;

      if (dto.cashPaid > remainingCashCap) {
        throw new BadRequestException(
          `Cash refund ${dto.cashPaid} exceeds remaining cash cap ${remainingCashCap}`,
        );
      }
      if (dto.creditPaid > remainingCreditCap) {
        throw new BadRequestException(
          `Credit refund ${dto.creditPaid} exceeds remaining credit cap ${remainingCreditCap}`,
        );
      }

      const originalVoucherPayments = originalInvoice.payments.filter(
        (p) => p.type === "voucher",
      );
      const alreadyRefundedVoucherPayments = existingRefunds
        .flatMap((r) => r.payments)
        .filter((p) => p.type === "voucher");

      const dtoVoucherPayments = dto.payments.filter(
        (p) => p.type === "voucher",
      );
      for (const vp of dtoVoucherPayments) {
        const originalVp = originalVoucherPayments.find(
          (p) => p.entityId === vp.entityId && p.entityType === vp.entityType,
        );
        if (!originalVp) {
          throw new BadRequestException(
            `Voucher entity ${vp.entityType}:${vp.entityId} not found on original invoice`,
          );
        }
        const alreadyRefunded = alreadyRefundedVoucherPayments
          .filter(
            (p) => p.entityId === vp.entityId && p.entityType === vp.entityType,
          )
          .reduce((acc, p) => acc + p.amount, 0);
        const remainingVoucherCap = originalVp.amount - alreadyRefunded;
        if (vp.amount > remainingVoucherCap) {
          throw new BadRequestException(
            `Voucher ${vp.entityType}:${vp.entityId} refund ${vp.amount} exceeds remaining cap ${remainingVoucherCap}`,
          );
        }
      }

      const invoice = await tx.saleInvoice.create({
        data: {
          type: "refund",
          original_invoice_id: originalInvoice.id,
          original_invoice_serialNumber: originalInvoice.serialNumber,
          companyId: company.id,
          companyName: storeSetting.name,
          abn: storeSetting.abn,
          address1: storeSetting.address1,
          address2: storeSetting.address2,
          suburb: storeSetting.suburb,
          state: storeSetting.state,
          postcode: storeSetting.postcode,
          country: company.country,
          phone: storeSetting.phone,
          email: storeSetting.email,
          website: storeSetting.website,
          memberId: originalInvoice.memberId,
          memberLevel: originalInvoice.memberLevel,
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
          voucherPaid: dto.voucherPaid ?? 0,
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
              discount_amount: row.discount_amount ?? 0,
            })),
          },
          payments: {
            create: dto.payments.map((p) => ({
              type: p.type,
              amount: p.amount,
              surcharge: p.surcharge,
              entityType: p.entityType,
              entityId: p.entityId,
            })),
          },
        },
        select: { id: true },
      });

      const serialNumber = `${company.id}-${shift.id}-${terminal.id}-${invoice.id}`;
      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { serialNumber },
      });

      const refundVoucherPayments = dto.payments.filter(
        (p) =>
          p.type === "voucher" &&
          p.entityType === "user-voucher" &&
          typeof p.entityId === "number",
      );

      for (const p of refundVoucherPayments) {
        const targetVoucher = await tx.userVoucher.findUnique({
          where: { id: p.entityId },
          select: { id: true, left_amount: true, userId: true },
        });

        if (!targetVoucher) throw new NotFoundException("Voucher not found");

        await tx.userVoucher.update({
          where: { id: p.entityId },
          data: {
            left_amount: targetVoucher.left_amount + p.amount,
          },
        });

        await tx.userVoucherHistory.create({
          data: {
            voucherId: targetVoucher.id,
            userId: targetVoucher.userId,
            spent_amount: -p.amount,
            saleInvoiceId: invoice.id,
            saleInvoiceSerialNumber: serialNumber,
          },
        });
      }

      return invoice;
    });

    await saleInvoiceSyncService(result.id);

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

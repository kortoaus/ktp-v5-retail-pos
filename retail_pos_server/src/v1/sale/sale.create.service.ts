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

type PaymentDto = {
  type: string;
  amount: number;     // cents
  surcharge: number;  // cents
  entityType?: string;
  entityId?: number;
};

type InvoiceRowDto = {
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
  original_invoice_id: number | null;
  original_invoice_row_id: number | null;
  adjustments: string[];
  tax_amount_included: number;
  discount_amount: number;
};

export interface DiscountDto {
  entityType: string;
  entityId: number;
  title: string;
  description: string;
  amount: number;
}

export type CreateSaleInvoiceDto = {
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
  rows: InvoiceRowDto[];
  payments: PaymentDto[];
  discounts: DiscountDto[];
};

export async function createSaleInvoiceService(
  company: Company,
  storeSetting: StoreSetting,
  terminal: Terminal,
  shift: TerminalShift,
  user: User,
  dto: CreateSaleInvoiceDto,
) {
  try {
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!company) throw new NotFoundException("Company not found");
    if (!storeSetting) throw new NotFoundException("Store setting not found");

    if (!dto.rows || dto.rows.length === 0) {
      throw new BadRequestException("At least one row is required");
    }
    if (!dto.payments || dto.payments.length === 0) {
      throw new BadRequestException("At least one payment is required");
    }

    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.create({
        data: {
          type: "sale",
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
          voucherPaid: dto.voucherPaid,
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
              discount_amount: row.discount_amount,
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
          discounts: {
            create: dto.discounts.map((d) => ({
              entityType: d.entityType,
              entityId: d.entityId,
              title: d.title,
              description: d.description,
              amount: d.amount,
            })),
          },
        },
        select: {
          id: true,
        },
      });

      const serialNumber = `${company.id}-${shift.id}-${terminal.id}-${invoice.id}`;
      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { serialNumber },
      });

      const userVoucherPayments = dto.payments.filter(
        (p) =>
          p.type === "voucher" &&
          p.entityType === "user-voucher" &&
          typeof p.entityId === "number",
      );

      for (const p of userVoucherPayments) {
        const targetVoucher = await tx.userVoucher.findUnique({
          where: { id: p.entityId },
          select: { id: true, left_amount: true, userId: true },
        });

        if (!targetVoucher) throw new NotFoundException("Voucher not found");
        if (targetVoucher.left_amount < p.amount)
          throw new BadRequestException("Voucher amount is not enough");

        await tx.userVoucher.update({
          where: { id: p.entityId },
          data: { left_amount: targetVoucher.left_amount - p.amount },
        });

        await tx.userVoucherHistory.create({
          data: {
            voucherId: targetVoucher.id,
            userId: targetVoucher.userId,
            spent_amount: p.amount,
            saleInvoiceId: invoice.id,
            saleInvoiceSerialNumber: serialNumber,
          },
        });
      }

      return invoice;
    });

    await saleInvoiceSyncService(result.id);

    return { ok: true, msg: "Invoice created", result: { id: result.id } };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSaleInvoiceService error:", e);
    throw new InternalServerException();
  }
}

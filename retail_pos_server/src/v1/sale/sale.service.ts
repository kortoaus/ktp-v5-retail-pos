import { TerminalShift } from "../../generated/prisma/browser";
import { Company, Terminal } from "../../generated/prisma/client";
import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";

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
};

type CreateSaleInvoiceDto = {
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
  memberId: number | null;
  memberLevel: number | null;
  rows: InvoiceRowDto[];
  payments: { type: string; amount: number; surcharge: number }[];
};

export async function createSaleInvoiceService(
  company: Company,
  terminal: Terminal,
  shift: TerminalShift,
  dto: CreateSaleInvoiceDto,
) {
  try {
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!company) throw new NotFoundException("Company not found");

    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.create({
        data: {
          type: "sale",
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
          userId: shift.openedUserId,
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
      });

      return invoice;
    });

    return { ok: true, msg: "Invoice created", result: { id: result.id } };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSaleInvoiceService error:", e);
    throw new InternalServerException();
  }
}

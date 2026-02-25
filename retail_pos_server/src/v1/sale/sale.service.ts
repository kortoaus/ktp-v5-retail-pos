import { TerminalShift } from "../../generated/prisma/browser";
import { Company, Terminal } from "../../generated/prisma/client";
import db from "../../libs/db";
import { SaleInvoiceWhereInput } from "../../generated/prisma/models";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";
import { numberifySaleInvoice, numberifyRow } from "../../libs/decimal-utils";
import { Decimal } from "@prisma/client/runtime/index-browser";

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
  memberId: string | null;
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
        select: {
          id: true,
        },
      });

      const serialNumber = `${company.id}-${shift.id}-${terminal.id}-${invoice.id}`;
      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { serialNumber },
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

export async function getSaleInvoicesService(query: FindManyQuery) {
  const { keyword = "", page, limit, from, to, memberId } = query;
  try {
    const kws = keyword
      .split(" ")
      .filter(Boolean)
      .map((kw) => kw.trim());

    const where: SaleInvoiceWhereInput = {
      AND: kws.map((kw) => ({
        OR: [
          { serialNumber: { contains: kw, mode: "insensitive" as const } },
          { companyName: { contains: kw, mode: "insensitive" as const } },
          {
            rows: {
              some: {
                OR: [
                  { name_en: { contains: kw, mode: "insensitive" as const } },
                  { name_ko: { contains: kw, mode: "insensitive" as const } },
                  { barcode: { contains: kw, mode: "insensitive" as const } },
                ],
              },
            },
          },
        ],
      })),
    };

    if (from || to) {
      where.issuedAt = {};
      if (from) where.issuedAt.gte = new Date(from);
      if (to) where.issuedAt.lte = new Date(to);
    }

    if (memberId) {
      where.memberId = memberId;
    }

    const totalCount = await db.saleInvoice.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.saleInvoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { issuedAt: "desc" },
      include: {
        rows: true,
        payments: true,
        terminal: true,
      },
    });

    return {
      ok: true,
      result: result.map(numberifySaleInvoice),
      paging: {
        currentPage: page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoicesService error:", e);
    throw new InternalServerException();
  }
}

export async function getSaleInvoiceByIdService(id: number) {
  try {
    const invoice = await db.saleInvoice.findUnique({
      where: { id },
      include: {
        rows: true,
        payments: true,
        terminal: true,
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return {
      ok: true,
      msg: "Invoice found",
      result: numberifySaleInvoice(invoice),
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoiceByIdService error:", e);
    throw new InternalServerException();
  }
}

export async function getLatestTerminalInvoiceService(terminal: Terminal) {
  try {
    const invoice = await db.saleInvoice.findFirst({
      where: { terminalId: terminal.id },
      orderBy: { issuedAt: "desc" },
      include: {
        rows: true,
        payments: true,
        terminal: true,
      },
    });
    return {
      ok: true,
      msg: "Invoice found",
      result: invoice ? numberifySaleInvoice(invoice) : null,
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getLatestTerminalInvoiceService error:", e);
    throw new InternalServerException();
  }
}

export async function getRefundableSaleInvoiceByIdService(id: number) {
  try {
    const invoice = await db.saleInvoice.findFirst({
      where: {
        id,
        type: "sale",
      },
      include: {
        payments: true,
        terminal: true,
      },
    });

    if (!invoice) throw new NotFoundException("Invoice not found");

    const refundedInvoices = await db.saleInvoice.findMany({
      where: {
        type: "refund",
        original_invoice_id: invoice.id,
      },
      include: {
        rows: true,
        payments: true,
        terminal: true,
      },
    });

    const originalRows = await db.saleInvoiceRow.findMany({
      where: {
        invoiceId: invoice.id,
      },
    });
    const refundedRows = refundedInvoices.flatMap((i) => i.rows);
    const patchedRows = originalRows.map((row) => {
      const refunds = refundedRows.filter(
        (r) => r.original_invoice_row_id === row.id,
      );

      const refundedQty = refunds.reduce(
        (acc, r) => acc.plus(r.qty),
        new Decimal(0),
      );
      const refundedTotal = refunds.reduce(
        (acc, r) => acc.plus(r.total),
        new Decimal(0),
      );
      const refundedTax = refunds.reduce(
        (acc, r) => acc.plus(r.tax_amount_included),
        new Decimal(0),
      );
      return {
        ...row,
        remainingQty: row.qty.minus(refundedQty).toNumber(),
        remainingTotal: row.total.minus(refundedTotal).toNumber(),
        remainingIncludedTaxAmount: row.tax_amount_included
          .minus(refundedTax)
          .toNumber(),
      };
    });

    return {
      ok: true,
      msg: "Refundable invoice found",
      result: {
        ...numberifySaleInvoice(invoice),
        rows: patchedRows.map(numberifyRow),
        refundedInvoices: refundedInvoices.map(numberifySaleInvoice),
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getRefundableSaleInvoiceByIdService error:", e);
    throw new InternalServerException();
  }
}

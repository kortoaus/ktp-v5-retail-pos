import { Terminal } from "../../generated/prisma/client";
import db from "../../libs/db";
import { SaleInvoiceWhereInput } from "../../generated/prisma/models";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";

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
        discounts: true,
        terminal: true,
      },
    });

    return {
      ok: true,
      result,
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
        discounts: true,
        terminal: true,
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return {
      ok: true,
      msg: "Invoice found",
      result: invoice,
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoiceByIdService error:", e);
    throw new InternalServerException();
  }
}

export async function getSaleInvoiceWithChildrenService(id: number) {
  try {
    const invoice = await db.saleInvoice.findUnique({
      where: { id },
      include: { rows: true, payments: true, terminal: true, discounts: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    const refundInvoices = await db.saleInvoice.findMany({
      where: { type: "refund", original_invoice_id: invoice.id },
      orderBy: { issuedAt: "asc" },
      include: { rows: true, payments: true, terminal: true },
    });

    return {
      ok: true,
      result: {
        invoice,
        refundInvoices,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoiceWithChildrenService error:", e);
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
        discounts: true,
      },
    });
    return {
      ok: true,
      msg: "Invoice found",
      result: invoice,
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
      where: { id, type: "sale" },
      include: { payments: true, terminal: true },
    });

    if (!invoice) throw new NotFoundException("Invoice not found");

    const refundedInvoices = await db.saleInvoice.findMany({
      where: { type: "refund", original_invoice_id: invoice.id },
      include: { rows: true, payments: true, terminal: true },
    });

    const originalRows = await db.saleInvoiceRow.findMany({
      where: { invoiceId: invoice.id },
    });
    const refundedRows = refundedInvoices.flatMap((i) => i.rows);
    const patchedRows = originalRows.map((row) => {
      const refunds = refundedRows.filter(
        (r) => r.original_invoice_row_id === row.id,
      );
      const refundedQty = refunds.reduce((acc, r) => acc + r.qty, 0);
      const refundedTotal = refunds.reduce((acc, r) => acc + r.total, 0);
      const refundedTax = refunds.reduce(
        (acc, r) => acc + r.tax_amount_included,
        0,
      );
      const netTotal = row.total - row.discount_amount;
      return {
        ...row,
        remainingQty: row.qty - refundedQty,
        remainingTotal: netTotal - refundedTotal,
        remainingIncludedTaxAmount: row.tax_amount_included - refundedTax,
      };
    });

    const originalCash = invoice.payments
      .filter((p) => p.type === "cash")
      .reduce((acc, p) => acc + p.amount, 0);
    const originalCredit = invoice.payments
      .filter((p) => p.type === "credit")
      .reduce((acc, p) => acc + p.amount, 0);
    const refundedCash = refundedInvoices
      .flatMap((r) => r.payments)
      .filter((p) => p.type === "cash")
      .reduce((acc, p) => acc + p.amount, 0);
    const refundedCredit = refundedInvoices
      .flatMap((r) => r.payments)
      .filter((p) => p.type === "credit")
      .reduce((acc, p) => acc + p.amount, 0);

    const originalVoucherPayments = invoice.payments.filter(
      (p) => p.type === "voucher",
    );
    const refundedVoucherPayments = refundedInvoices
      .flatMap((r) => r.payments)
      .filter((p) => p.type === "voucher");

    const remainingVouchers = originalVoucherPayments.map((vp) => {
      const refundedAmount = refundedVoucherPayments
        .filter(
          (rp) =>
            rp.entityId === vp.entityId && rp.entityType === vp.entityType,
        )
        .reduce((acc, rp) => acc + rp.amount, 0);
      return {
        entityType: vp.entityType,
        entityId: vp.entityId,
        originalAmount: vp.amount,
        remainingAmount: vp.amount - refundedAmount,
      };
    });
    const remainingVoucher = remainingVouchers.reduce(
      (acc, v) => acc + v.remainingAmount,
      0,
    );

    return {
      ok: true,
      msg: "Refundable invoice found",
      result: {
        ...invoice,
        rows: patchedRows,
        refundedInvoices,
        remainingCash: originalCash - refundedCash,
        remainingCredit: originalCredit - refundedCredit,
        remainingVoucher,
        remainingVouchers,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getRefundableSaleInvoiceByIdService error:", e);
    throw new InternalServerException();
  }
}

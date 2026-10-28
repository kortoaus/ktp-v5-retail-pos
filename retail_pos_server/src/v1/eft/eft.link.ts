import type { Prisma } from "../../generated/prisma/client";

/**
 * A-2: link every EFT attempt of this sale/refund to the invoice the till just
 * wrote, by the shared operation id (declined and timed-out attempts too —
 * the invoice keeps the full bank trail). Runs inside the invoice transaction;
 * the EFT row is the source of truth for what the bank said, the invoice for
 * the sale. No column on SaleInvoice / SaleInvoicePayment.
 */
export async function linkEftTransactionsInTx(
  tx: Prisma.TransactionClient,
  operationId: string,
  kind: "PURCHASE" | "REFUND",
  invoiceId: number,
): Promise<number> {
  const { count } = await tx.eftTransaction.updateMany({
    where: { saleOperationId: operationId, kind, invoiceId: null },
    data: { invoiceId },
  });
  return count;
}

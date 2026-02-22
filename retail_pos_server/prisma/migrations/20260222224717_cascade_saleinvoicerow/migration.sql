-- DropForeignKey
ALTER TABLE "SaleInvoiceRow" DROP CONSTRAINT "SaleInvoiceRow_invoiceId_fkey";

-- AddForeignKey
ALTER TABLE "SaleInvoiceRow" ADD CONSTRAINT "SaleInvoiceRow_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the `SaleInvoiceDiscount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SaleInvoiceDiscount" DROP CONSTRAINT "SaleInvoiceDiscount_invoiceId_fkey";

-- DropTable
DROP TABLE "SaleInvoiceDiscount";

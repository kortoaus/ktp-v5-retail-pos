/*
  Warnings:

  - You are about to drop the column `includedTaxAmount` on the `SaleInvoiceRow` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SaleInvoiceRow" DROP COLUMN "includedTaxAmount",
ADD COLUMN     "tax_amount_included" DECIMAL(18,2) NOT NULL DEFAULT 0;

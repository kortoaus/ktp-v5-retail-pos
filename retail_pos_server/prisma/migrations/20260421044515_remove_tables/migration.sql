/*
  Warnings:

  - You are about to drop the `SaleInvoice` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SaleInvoicePayment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SaleInvoiceRow` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserVoucher` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserVoucherHistory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SaleInvoice" DROP CONSTRAINT "SaleInvoice_shiftId_fkey";

-- DropForeignKey
ALTER TABLE "SaleInvoice" DROP CONSTRAINT "SaleInvoice_terminalId_fkey";

-- DropForeignKey
ALTER TABLE "SaleInvoice" DROP CONSTRAINT "SaleInvoice_userId_fkey";

-- DropForeignKey
ALTER TABLE "SaleInvoicePayment" DROP CONSTRAINT "SaleInvoicePayment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "SaleInvoiceRow" DROP CONSTRAINT "SaleInvoiceRow_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "UserVoucher" DROP CONSTRAINT "UserVoucher_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserVoucherHistory" DROP CONSTRAINT "UserVoucherHistory_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserVoucherHistory" DROP CONSTRAINT "UserVoucherHistory_voucherId_fkey";

-- DropForeignKey (shadow DB replay fix — SaleInvoiceDiscount FK blocks SaleInvoice drop)
ALTER TABLE "SaleInvoiceDiscount" DROP CONSTRAINT "SaleInvoiceDiscount_invoiceId_fkey";

-- DropTable
DROP TABLE "SaleInvoice";

-- DropTable
DROP TABLE "SaleInvoicePayment";

-- DropTable
DROP TABLE "SaleInvoiceRow";

-- DropTable
DROP TABLE "UserVoucher";

-- DropTable
DROP TABLE "UserVoucherHistory";

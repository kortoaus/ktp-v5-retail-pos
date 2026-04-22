/*
  Warnings:

  - You are about to drop the column `cashIn` on the `TerminalShift` table. All the data in the column will be lost.
  - You are about to drop the column `cashOut` on the `TerminalShift` table. All the data in the column will be lost.
  - You are about to drop the column `startedCach` on the `TerminalShift` table. All the data in the column will be lost.
  - You are about to drop the `Staff` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CREDIT', 'VOUCHER', 'GIFTCARD');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALE', 'REFUND', 'SPEND');

-- CreateEnum
CREATE TYPE "SaleInvoiceRowType" AS ENUM ('NORMAL', 'PREPACKED', 'WEIGHT', 'WEIGHT_PREPACKED');

-- CreateEnum
CREATE TYPE "LineAdjustment" AS ENUM ('PRICE_OVERRIDE');

-- AlterTable
ALTER TABLE "TerminalShift" DROP COLUMN "cashIn",
DROP COLUMN "cashOut",
DROP COLUMN "startedCach",
ADD COLUMN     "refundsCreditSurcharge" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsGiftcard" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesCreditSurcharge" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesGiftcard" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedCash" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "Staff";

-- CreateTable
CREATE TABLE "SaleInvoice" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "serial" TEXT,
    "dayStr" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'SALE',
    "originalInvoiceId" INTEGER,
    "shiftId" INTEGER NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "abn" TEXT,
    "phone" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "suburb" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "terminalName" TEXT,
    "userName" TEXT,
    "memberId" TEXT,
    "memberName" TEXT,
    "memberLevel" INTEGER,
    "memberPhoneLast4" TEXT,
    "linesTotal" INTEGER NOT NULL,
    "rounding" INTEGER NOT NULL DEFAULT 0,
    "creditSurchargeAmount" INTEGER NOT NULL DEFAULT 0,
    "lineTax" INTEGER NOT NULL DEFAULT 0,
    "surchargeTax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "cashChange" INTEGER NOT NULL DEFAULT 0,
    "receiptCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "synced" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "cloudId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInvoicePayment" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "entityType" TEXT,
    "entityId" INTEGER,
    "entityLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleInvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInvoiceRow" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "SaleInvoiceRowType" NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "unit_price_original" INTEGER NOT NULL,
    "unit_price_discounted" INTEGER,
    "unit_price_adjusted" INTEGER,
    "unit_price_effective" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "measured_weight" INTEGER,
    "total" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "adjustments" "LineAdjustment"[],
    "ppMarkdownType" TEXT,
    "ppMarkdownAmount" INTEGER,
    "originalInvoiceId" INTEGER,
    "originalInvoiceRowId" INTEGER,
    "refunded_qty" INTEGER NOT NULL DEFAULT 0,
    "surcharge_share" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleInvoiceRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleInvoice_serial_key" ON "SaleInvoice"("serial");

-- CreateIndex
CREATE INDEX "SaleInvoice_shiftId_idx" ON "SaleInvoice"("shiftId");

-- CreateIndex
CREATE INDEX "SaleInvoice_terminalId_idx" ON "SaleInvoice"("terminalId");

-- CreateIndex
CREATE INDEX "SaleInvoice_userId_idx" ON "SaleInvoice"("userId");

-- CreateIndex
CREATE INDEX "SaleInvoice_dayStr_idx" ON "SaleInvoice"("dayStr");

-- CreateIndex
CREATE INDEX "SaleInvoice_type_dayStr_idx" ON "SaleInvoice"("type", "dayStr");

-- CreateIndex
CREATE INDEX "SaleInvoice_synced_idx" ON "SaleInvoice"("synced");

-- CreateIndex
CREATE INDEX "SaleInvoice_memberId_idx" ON "SaleInvoice"("memberId");

-- CreateIndex
CREATE INDEX "SaleInvoice_originalInvoiceId_idx" ON "SaleInvoice"("originalInvoiceId");

-- CreateIndex
CREATE INDEX "SaleInvoicePayment_invoiceId_idx" ON "SaleInvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "SaleInvoicePayment_type_createdAt_idx" ON "SaleInvoicePayment"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SaleInvoiceRow_invoiceId_idx" ON "SaleInvoiceRow"("invoiceId");

-- CreateIndex
CREATE INDEX "SaleInvoiceRow_itemId_idx" ON "SaleInvoiceRow"("itemId");

-- CreateIndex
CREATE INDEX "SaleInvoiceRow_originalInvoiceId_idx" ON "SaleInvoiceRow"("originalInvoiceId");

-- CreateIndex
CREATE INDEX "SaleInvoiceRow_originalInvoiceRowId_idx" ON "SaleInvoiceRow"("originalInvoiceRowId");

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "TerminalShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoicePayment" ADD CONSTRAINT "SaleInvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoiceRow" ADD CONSTRAINT "SaleInvoiceRow_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

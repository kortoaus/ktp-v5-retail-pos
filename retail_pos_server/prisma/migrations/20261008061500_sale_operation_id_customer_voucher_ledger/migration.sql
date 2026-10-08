-- T-15 (platform/D-10): SaleInvoice operation identity + customer-voucher operation ledger.
-- Generated with prisma migrate diff against local dev, read before apply: additive only
-- (no DROP/RENAME; the R-2 partial unique index on Voucher is untouched).

-- CreateEnum
CREATE TYPE "CustomerVoucherOperationKind" AS ENUM ('REDEEM', 'VOID_REDEEM', 'REFUND_ISSUE', 'VOID_REFUND_ISSUE');

-- CreateEnum
CREATE TYPE "CustomerVoucherOperationStatus" AS ENUM ('INTENT', 'CONFIRMED', 'LINKED', 'VOIDED', 'UNRESOLVED', 'FAILED');

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "operationId" TEXT,
ADD COLUMN     "operationPayloadHash" TEXT;

-- CreateTable
CREATE TABLE "CustomerVoucherOperation" (
    "id" SERIAL NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" "CustomerVoucherOperationKind" NOT NULL,
    "voucherId" INTEGER,
    "memberId" TEXT,
    "amount" INTEGER NOT NULL,
    "crmRequestId" TEXT NOT NULL,
    "status" "CustomerVoucherOperationStatus" NOT NULL DEFAULT 'INTENT',
    "invoiceId" INTEGER,
    "crmEventId" INTEGER,
    "crmVoucherId" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerVoucherOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerVoucherOperation_crmRequestId_key" ON "CustomerVoucherOperation"("crmRequestId");

-- CreateIndex
CREATE INDEX "CustomerVoucherOperation_operationId_idx" ON "CustomerVoucherOperation"("operationId");

-- CreateIndex
CREATE INDEX "CustomerVoucherOperation_status_updatedAt_idx" ON "CustomerVoucherOperation"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleInvoice_operationId_key" ON "SaleInvoice"("operationId");


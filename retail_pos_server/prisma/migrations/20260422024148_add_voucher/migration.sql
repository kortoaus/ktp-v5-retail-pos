-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VoucherEventType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUST');

-- CreateTable
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "initAmount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherEvent" (
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "type" "VoucherEventType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "userId" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Voucher_userId_idx" ON "Voucher"("userId");

-- CreateIndex
CREATE INDEX "Voucher_status_idx" ON "Voucher"("status");

-- CreateIndex
CREATE INDEX "VoucherEvent_voucherId_idx" ON "VoucherEvent"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherEvent_invoiceId_idx" ON "VoucherEvent"("invoiceId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherEvent" ADD CONSTRAINT "VoucherEvent_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

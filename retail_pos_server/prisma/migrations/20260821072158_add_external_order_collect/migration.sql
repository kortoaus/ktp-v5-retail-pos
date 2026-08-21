/*
  Warnings:

  - A unique constraint covering the columns `[externalOrderId]` on the table `SaleInvoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "externalOrderCollectSyncedAt" TIMESTAMP(3),
ADD COLUMN     "externalOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SaleInvoice_externalOrderId_key" ON "SaleInvoice"("externalOrderId");

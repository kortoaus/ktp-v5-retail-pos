/*
  Warnings:

  - You are about to drop the column `synced` on the `SaleInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `syncedAt` on the `SaleInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `synced` on the `TerminalShift` table. All the data in the column will be lost.
  - You are about to drop the column `syncedAt` on the `TerminalShift` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "SaleInvoice_synced_idx";

-- AlterTable
ALTER TABLE "SaleInvoice" DROP COLUMN "synced",
DROP COLUMN "syncedAt";

-- AlterTable
ALTER TABLE "TerminalShift" DROP COLUMN "synced",
DROP COLUMN "syncedAt",
ADD COLUMN     "cloudId" INTEGER;

-- CreateIndex
CREATE INDEX "SaleInvoice_cloudId_idx" ON "SaleInvoice"("cloudId");

-- CreateIndex
CREATE INDEX "TerminalShift_cloudId_idx" ON "TerminalShift"("cloudId");

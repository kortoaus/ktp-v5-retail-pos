-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "synced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

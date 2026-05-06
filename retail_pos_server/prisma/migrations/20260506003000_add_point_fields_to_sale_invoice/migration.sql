-- Add sale point earning snapshots.
ALTER TABLE "SaleInvoice" ADD COLUMN "pointsEarned" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SaleInvoiceRow" ADD COLUMN "isPointExcluded" BOOLEAN NOT NULL DEFAULT false;

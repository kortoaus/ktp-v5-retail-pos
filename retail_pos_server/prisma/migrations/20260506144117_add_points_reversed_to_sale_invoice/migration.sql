-- Add refund point reversal snapshot.
ALTER TABLE "SaleInvoice" ADD COLUMN "pointsReversed" INTEGER NOT NULL DEFAULT 0;

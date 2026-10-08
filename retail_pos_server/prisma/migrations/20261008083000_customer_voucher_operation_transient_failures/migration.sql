-- T-15 review F-12: transport failures counted apart from the UNRESOLVED_MANUAL budget.
-- Generated with prisma migrate diff against local dev, read before apply: additive only.

-- AlterTable
ALTER TABLE "CustomerVoucherOperation" ADD COLUMN     "transientFailures" INTEGER NOT NULL DEFAULT 0;

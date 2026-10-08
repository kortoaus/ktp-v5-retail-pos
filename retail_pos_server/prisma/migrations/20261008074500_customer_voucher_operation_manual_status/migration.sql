-- T-15 review F-10: terminal status for ledger rows the reconciler gave up on.
-- Generated with prisma migrate diff against local dev, read before apply: additive only.

-- AlterEnum
ALTER TYPE "CustomerVoucherOperationStatus" ADD VALUE 'UNRESOLVED_MANUAL';

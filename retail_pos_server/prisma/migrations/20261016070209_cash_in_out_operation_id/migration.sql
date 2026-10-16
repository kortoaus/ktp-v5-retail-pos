-- T-10 (retail-runner, F-27): Cash In/Out operation identity.
-- Additive only: two nullable columns + a unique index (NULLs never collide),
-- so existing rows and older tills are unaffected.
-- AlterTable
ALTER TABLE "CashInOut" ADD COLUMN     "operationId" TEXT,
ADD COLUMN     "operationPayloadHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CashInOut_operationId_key" ON "CashInOut"("operationId");

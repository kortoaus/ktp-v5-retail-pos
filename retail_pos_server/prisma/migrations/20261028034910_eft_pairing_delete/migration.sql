-- retail-eftpos T-9 (F-19): a deleted pairing leaves its past transactions (and their EftEvents)
-- in place; EftTransaction.eftPairingId becomes nullable and is set NULL on delete.

-- DropForeignKey
ALTER TABLE "EftTransaction" DROP CONSTRAINT "EftTransaction_eftPairingId_fkey";

-- AlterTable
ALTER TABLE "EftTransaction" ALTER COLUMN "eftPairingId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "EftTransaction" ADD CONSTRAINT "EftTransaction_eftPairingId_fkey" FOREIGN KEY ("eftPairingId") REFERENCES "EftPairing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

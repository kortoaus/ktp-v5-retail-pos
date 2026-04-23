/*
  Warnings:

  - You are about to drop the column `refundsVoucher` on the `TerminalShift` table. All the data in the column will be lost.
  - You are about to drop the column `salesVoucher` on the `TerminalShift` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TerminalShift" DROP COLUMN "refundsVoucher",
DROP COLUMN "salesVoucher",
ADD COLUMN     "refundsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsCustomerVoucher" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsLinesTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsRounding" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsUserVoucher" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repayCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesCustomerVoucher" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesLinesTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesRounding" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesUserVoucher" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spendRetailValue" INTEGER NOT NULL DEFAULT 0;

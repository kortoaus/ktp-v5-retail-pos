-- AlterTable
ALTER TABLE "TerminalShift" ADD COLUMN     "refundsCash" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsCredit" INTEGER NOT NULL DEFAULT 0;

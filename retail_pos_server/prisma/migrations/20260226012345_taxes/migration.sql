/*
  Warnings:

  - You are about to drop the column `tax_amount_included` on the `TerminalShift` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TerminalShift" DROP COLUMN "tax_amount_included",
ADD COLUMN     "refundsTax" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesTax" INTEGER NOT NULL DEFAULT 0;

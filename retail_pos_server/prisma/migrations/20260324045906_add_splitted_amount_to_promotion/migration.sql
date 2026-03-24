/*
  Warnings:

  - You are about to drop the column `discountAmounts` on the `Promotion` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Promotion" DROP COLUMN "discountAmounts",
ADD COLUMN     "discountFlatAmounts" DOUBLE PRECISION[],
ADD COLUMN     "discountPercentAmounts" DOUBLE PRECISION[];

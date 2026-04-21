/*
  Warnings:

  - You are about to drop the column `discountFlatAmounts` on the `Promotion` table. All the data in the column will be lost.
  - You are about to drop the column `discountPercentAmounts` on the `Promotion` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Promotion" DROP COLUMN "discountFlatAmounts",
DROP COLUMN "discountPercentAmounts",
ADD COLUMN     "discountAmounts" INTEGER[],
ADD COLUMN     "discountPercents" INTEGER[];

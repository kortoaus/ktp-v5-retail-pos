/*
  Warnings:

  - Changed the type of `cloudId` on the `Company` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Company" DROP COLUMN "cloudId",
ADD COLUMN     "cloudId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Company_cloudId_key" ON "Company"("cloudId");

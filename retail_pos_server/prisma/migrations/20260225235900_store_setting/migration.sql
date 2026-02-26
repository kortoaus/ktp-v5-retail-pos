/*
  Warnings:

  - You are about to drop the column `creditCardSurchargeRate` on the `Company` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Company" DROP COLUMN "creditCardSurchargeRate";

-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "name1" TEXT NOT NULL,
    "name2" TEXT,
    "phone" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "suburb" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "abn" TEXT,
    "website" TEXT,
    "email" TEXT,
    "credit_surcharge_rate" DOUBLE PRECISION DEFAULT 0.015,
    "receipt_below_text" TEXT DEFAULT 'Thank you!',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('BUY_MORE_SAVE_MORE', 'MIX_AND_SAVE', 'N_FOR_N_MINUS_ONE');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" INTEGER NOT NULL,
    "type" "PromotionType" NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "desc_en" TEXT,
    "desc_ko" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requiredItemIds" INTEGER[],
    "allowedItemIds" INTEGER[],
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "maxQty" INTEGER,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountAmounts" DOUBLE PRECISION[],

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_companyId_idx" ON "Promotion"("companyId");

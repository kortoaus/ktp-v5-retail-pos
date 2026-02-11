-- CreateEnum
CREATE TYPE "ItemRFD" AS ENUM ('R', 'F', 'D');

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "parentId" INTEGER,
    "index" INTEGER NOT NULL DEFAULT 999,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "companyId" INTEGER NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "name_invoice" TEXT,
    "barcode" TEXT NOT NULL,
    "code" TEXT,
    "thumb" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'ea',
    "defaultRFD" "ItemRFD" NOT NULL DEFAULT 'D',
    "isScale" BOOLEAN NOT NULL DEFAULT false,
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "useBatch" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "bundleQty" INTEGER NOT NULL DEFAULT 1,
    "parentId" INTEGER,
    "brandId" INTEGER,
    "categoryIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "categoryMarks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "wholesaleTaxable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemScaleData" (
    "itemId" INTEGER NOT NULL,
    "fixedWeightString" TEXT,
    "usedBy" INTEGER NOT NULL DEFAULT 1,
    "isFixedWeight" BOOLEAN NOT NULL DEFAULT false,
    "ingredients" TEXT,

    CONSTRAINT "ItemScaleData_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "itemId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("itemId","categoryId")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "priceType" TEXT NOT NULL,
    "prices" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "markup" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoPrice" (
    "id" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "priceType" TEXT NOT NULL,
    "prices" DOUBLE PRECISION[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_companyId_parentId_idx" ON "Category"("companyId", "parentId");

-- CreateIndex
CREATE INDEX "Brand_companyId_idx" ON "Brand"("companyId");

-- CreateIndex
CREATE INDEX "Item_companyId_idx" ON "Item"("companyId");

-- CreateIndex
CREATE INDEX "Item_companyId_name_en_idx" ON "Item"("companyId", "name_en");

-- CreateIndex
CREATE INDEX "Item_companyId_name_ko_idx" ON "Item"("companyId", "name_ko");

-- CreateIndex
CREATE INDEX "Item_companyId_brandId_idx" ON "Item"("companyId", "brandId");

-- CreateIndex
CREATE INDEX "Price_itemId_idx" ON "Price"("itemId");

-- CreateIndex
CREATE INDEX "PromoPrice_itemId_idx" ON "PromoPrice"("itemId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemScaleData" ADD CONSTRAINT "ItemScaleData_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

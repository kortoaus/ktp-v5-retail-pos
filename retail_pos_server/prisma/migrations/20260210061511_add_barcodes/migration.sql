-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('RAW', 'GTIN', 'PLU', 'UPC', 'EAN');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "barcodeGTIN" TEXT,
ADD COLUMN     "barcodePLU" TEXT,
ADD COLUMN     "barcodeType" TEXT NOT NULL DEFAULT 'RAW';

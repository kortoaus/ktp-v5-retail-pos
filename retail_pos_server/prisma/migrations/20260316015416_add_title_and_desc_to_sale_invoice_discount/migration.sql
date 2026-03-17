/*
  Warnings:

  - You are about to drop the column `name` on the `SaleInvoiceDiscount` table. All the data in the column will be lost.
  - Added the required column `title` to the `SaleInvoiceDiscount` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SaleInvoiceDiscount" DROP COLUMN "name",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT NOT NULL;

/*
  Warnings:

  - You are about to alter the column `amount` on the `CashInOut` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `subtotal` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `documentDiscountAmount` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `creditSurchargeAmount` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `rounding` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `total` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `taxAmount` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `cashPaid` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `cashChange` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `creditPaid` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `totalDiscountAmount` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `voucherPaid` on the `SaleInvoice` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `amount` on the `SaleInvoiceDiscount` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `amount` on the `SaleInvoicePayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `surcharge` on the `SaleInvoicePayment` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `barcodePrice` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `unit_price_original` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `unit_price_discounted` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `unit_price_adjusted` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `unit_price_effective` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `qty` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,3)` to `Integer`.
  - You are about to alter the column `measured_weight` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,3)` to `Integer`.
  - You are about to alter the column `subtotal` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `total` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `tax_amount_included` on the `SaleInvoiceRow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `init_amount` on the `UserVoucher` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `left_amount` on the `UserVoucher` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.
  - You are about to alter the column `spent_amount` on the `UserVoucherHistory` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,2)` to `Integer`.

*/
-- AlterTable
ALTER TABLE "CashInOut" ALTER COLUMN "amount" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "SaleInvoice" ALTER COLUMN "subtotal" SET DATA TYPE INTEGER,
ALTER COLUMN "documentDiscountAmount" SET DATA TYPE INTEGER,
ALTER COLUMN "creditSurchargeAmount" SET DATA TYPE INTEGER,
ALTER COLUMN "rounding" SET DATA TYPE INTEGER,
ALTER COLUMN "total" SET DATA TYPE INTEGER,
ALTER COLUMN "taxAmount" SET DATA TYPE INTEGER,
ALTER COLUMN "cashPaid" SET DATA TYPE INTEGER,
ALTER COLUMN "cashChange" SET DATA TYPE INTEGER,
ALTER COLUMN "creditPaid" SET DATA TYPE INTEGER,
ALTER COLUMN "totalDiscountAmount" SET DATA TYPE INTEGER,
ALTER COLUMN "voucherPaid" SET DEFAULT 0,
ALTER COLUMN "voucherPaid" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "SaleInvoiceDiscount" ALTER COLUMN "amount" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "SaleInvoicePayment" ALTER COLUMN "amount" SET DATA TYPE INTEGER,
ALTER COLUMN "surcharge" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "SaleInvoiceRow" ALTER COLUMN "barcodePrice" SET DATA TYPE INTEGER,
ALTER COLUMN "unit_price_original" SET DATA TYPE INTEGER,
ALTER COLUMN "unit_price_discounted" SET DATA TYPE INTEGER,
ALTER COLUMN "unit_price_adjusted" SET DATA TYPE INTEGER,
ALTER COLUMN "unit_price_effective" SET DATA TYPE INTEGER,
ALTER COLUMN "qty" SET DATA TYPE INTEGER,
ALTER COLUMN "measured_weight" SET DATA TYPE INTEGER,
ALTER COLUMN "subtotal" SET DATA TYPE INTEGER,
ALTER COLUMN "total" SET DATA TYPE INTEGER,
ALTER COLUMN "tax_amount_included" SET DEFAULT 0,
ALTER COLUMN "tax_amount_included" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "UserVoucher" ALTER COLUMN "init_amount" SET DATA TYPE INTEGER,
ALTER COLUMN "left_amount" SET DEFAULT 0,
ALTER COLUMN "left_amount" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "UserVoucherHistory" ALTER COLUMN "spent_amount" SET DATA TYPE INTEGER;

/*
  Warnings:

  - You are about to alter the column `prices` on the `Price` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `prices` on the `PromoPrice` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `discountFlatAmounts` on the `Promotion` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `discountPercentAmounts` on the `Promotion` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `credit_surcharge_rate` on the `StoreSetting` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `user_daily_voucher_default` on the `StoreSetting` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Price" ALTER COLUMN "prices" SET DATA TYPE INTEGER[];

-- AlterTable
ALTER TABLE "PromoPrice" ALTER COLUMN "prices" SET DATA TYPE INTEGER[];

-- AlterTable
ALTER TABLE "Promotion" ALTER COLUMN "discountFlatAmounts" SET DATA TYPE INTEGER[],
ALTER COLUMN "discountPercentAmounts" SET DATA TYPE INTEGER[];

-- AlterTable
ALTER TABLE "StoreSetting" ALTER COLUMN "credit_surcharge_rate" SET DEFAULT 15,
ALTER COLUMN "credit_surcharge_rate" SET DATA TYPE INTEGER,
ALTER COLUMN "user_daily_voucher_default" SET DEFAULT 2000,
ALTER COLUMN "user_daily_voucher_default" SET DATA TYPE INTEGER;

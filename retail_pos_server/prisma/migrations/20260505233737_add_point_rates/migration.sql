-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "cash_point_rate" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "other_point_rate" INTEGER NOT NULL DEFAULT 10;

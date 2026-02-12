-- AlterTable
ALTER TABLE "PromoPrice" ADD COLUMN     "name_en" TEXT NOT NULL DEFAULT 'Promo Price',
ADD COLUMN     "name_ko" TEXT NOT NULL DEFAULT '프로모션 가격';

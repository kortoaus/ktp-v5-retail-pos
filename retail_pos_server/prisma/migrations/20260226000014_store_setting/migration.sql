/*
  Warnings:

  - You are about to drop the column `name1` on the `StoreSetting` table. All the data in the column will be lost.
  - You are about to drop the column `name2` on the `StoreSetting` table. All the data in the column will be lost.
  - Added the required column `name` to the `StoreSetting` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StoreSetting" DROP COLUMN "name1",
DROP COLUMN "name2",
ADD COLUMN     "name" TEXT NOT NULL;

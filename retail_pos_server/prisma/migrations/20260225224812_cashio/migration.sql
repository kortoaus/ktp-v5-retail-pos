/*
  Warnings:

  - Added the required column `userName` to the `CashInOut` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CashInOut" ADD COLUMN     "userName" TEXT NOT NULL;

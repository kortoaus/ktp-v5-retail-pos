/*
  Warnings:

  - Added the required column `name` to the `Terminal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "name" TEXT NOT NULL;

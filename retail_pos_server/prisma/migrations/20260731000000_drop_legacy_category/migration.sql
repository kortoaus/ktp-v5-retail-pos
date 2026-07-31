-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ItemCategory" DROP CONSTRAINT "ItemCategory_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "ItemCategory" DROP CONSTRAINT "ItemCategory_itemId_fkey";

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "categoryIds";

-- DropTable
DROP TABLE "Category";

-- DropTable
DROP TABLE "ItemCategory";

-- DropForeignKey
ALTER TABLE "PickupOrderLineCache" DROP CONSTRAINT "PickupOrderLineCache_crmOrderId_fkey";

-- DropTable
DROP TABLE "PickupOrderCache";

-- DropTable
DROP TABLE "PickupOrderLineCache";

-- DropTable
DROP TABLE "PickupOrderSyncState";

-- DropTable
DROP TABLE "PrintedHistory";

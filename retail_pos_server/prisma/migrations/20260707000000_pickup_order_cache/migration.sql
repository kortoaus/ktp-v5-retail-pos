CREATE TABLE "PickupOrderCache" (
    "id" SERIAL NOT NULL,
    "crmOrderId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "memberLevel" INTEGER NOT NULL,
    "memberPhoneLast4" TEXT,
    "pickupStartsAt" TIMESTAMP(3) NOT NULL,
    "linesTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "crmCreatedAt" TIMESTAMP(3) NOT NULL,
    "crmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupOrderLineCache" (
    "id" SERIAL NOT NULL,
    "crmLineId" INTEGER NOT NULL,
    "crmOrderId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "code" TEXT,
    "uom" TEXT NOT NULL,
    "prices" INTEGER[],
    "promoPrices" JSONB,
    "memberLevel" INTEGER NOT NULL,
    "optionTotal" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "note" TEXT,
    "selectedOptionsSnapshot" JSONB NOT NULL,
    "crmCreatedAt" TIMESTAMP(3) NOT NULL,
    "crmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderLineCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupOrderSyncState" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "cursorUpdatedAt" TIMESTAMP(3),
    "cursorOrderId" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickupOrderCache_crmOrderId_key" ON "PickupOrderCache"("crmOrderId");
CREATE UNIQUE INDEX "PickupOrderCache_documentId_key" ON "PickupOrderCache"("documentId");
CREATE INDEX "PickupOrderCache_companyId_status_pickupStartsAt_idx" ON "PickupOrderCache"("companyId", "status", "pickupStartsAt");
CREATE INDEX "PickupOrderCache_companyId_pickupStartsAt_idx" ON "PickupOrderCache"("companyId", "pickupStartsAt");
CREATE INDEX "PickupOrderCache_companyId_crmUpdatedAt_idx" ON "PickupOrderCache"("companyId", "crmUpdatedAt");
CREATE INDEX "PickupOrderCache_companyId_syncedAt_idx" ON "PickupOrderCache"("companyId", "syncedAt");

CREATE UNIQUE INDEX "PickupOrderLineCache_crmLineId_key" ON "PickupOrderLineCache"("crmLineId");
CREATE INDEX "PickupOrderLineCache_crmOrderId_index_idx" ON "PickupOrderLineCache"("crmOrderId", "index");
CREATE INDEX "PickupOrderLineCache_itemId_idx" ON "PickupOrderLineCache"("itemId");
CREATE INDEX "PickupOrderLineCache_barcode_idx" ON "PickupOrderLineCache"("barcode");
CREATE INDEX "PickupOrderLineCache_code_idx" ON "PickupOrderLineCache"("code");

CREATE UNIQUE INDEX "PickupOrderSyncState_key_key" ON "PickupOrderSyncState"("key");

ALTER TABLE "PickupOrderLineCache" ADD CONSTRAINT "PickupOrderLineCache_crmOrderId_fkey" FOREIGN KEY ("crmOrderId") REFERENCES "PickupOrderCache"("crmOrderId") ON DELETE CASCADE ON UPDATE CASCADE;

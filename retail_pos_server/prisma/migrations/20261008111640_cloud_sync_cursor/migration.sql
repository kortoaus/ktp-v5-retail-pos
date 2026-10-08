-- CreateTable
CREATE TABLE "CloudSyncCursor" (
    "kind" TEXT NOT NULL,
    "cursorAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudSyncCursor_pkey" PRIMARY KEY ("kind")
);

-- Seed (T-16 / D-12): each feed's cursor starts one day behind the local max
-- updatedAt, so changes the old local-timestamp cursor may have skipped are
-- re-pulled on the first Sync after deploy (upserts make the overlap harmless).
-- Empty table -> epoch 0 (full pull). Company is pulled whole and has no cursor.
INSERT INTO "CloudSyncCursor" ("kind", "cursorAt", "updatedAt")
SELECT 'brand', COALESCE(MAX("updatedAt") - INTERVAL '1 day', TIMESTAMP '1970-01-01 00:00:00'), CURRENT_TIMESTAMP FROM "Brand"
UNION ALL
SELECT 'item', COALESCE(MAX("updatedAt") - INTERVAL '1 day', TIMESTAMP '1970-01-01 00:00:00'), CURRENT_TIMESTAMP FROM "Item"
UNION ALL
SELECT 'price', COALESCE(MAX("updatedAt") - INTERVAL '1 day', TIMESTAMP '1970-01-01 00:00:00'), CURRENT_TIMESTAMP FROM "Price"
UNION ALL
SELECT 'promoPrice', COALESCE(MAX("updatedAt") - INTERVAL '1 day', TIMESTAMP '1970-01-01 00:00:00'), CURRENT_TIMESTAMP FROM "PromoPrice"
UNION ALL
SELECT 'hotkey', COALESCE(MAX("updatedAt") - INTERVAL '1 day', TIMESTAMP '1970-01-01 00:00:00'), CURRENT_TIMESTAMP FROM "CloudHotkey"
ON CONFLICT ("kind") DO NOTHING;

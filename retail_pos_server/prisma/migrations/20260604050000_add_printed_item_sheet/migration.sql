-- Persist store-global label-update printed state in the local POS database.
CREATE TABLE "PrintedItemSheet" (
    "id" SERIAL NOT NULL,
    "sheetId" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintedItemSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrintedItemSheet_sheetId_key" ON "PrintedItemSheet"("sheetId");

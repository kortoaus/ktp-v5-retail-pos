CREATE TABLE "PrintedHistory" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintedHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintedHistory_entityType_entityId_idx" ON "PrintedHistory"("entityType", "entityId");
CREATE INDEX "PrintedHistory_entityType_printedAt_idx" ON "PrintedHistory"("entityType", "printedAt");

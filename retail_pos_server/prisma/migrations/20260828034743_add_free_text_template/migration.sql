-- CreateTable
CREATE TABLE "FreeTextTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeTextTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreeTextTemplate_name_key" ON "FreeTextTemplate"("name");

-- CreateIndex
CREATE INDEX "FreeTextTemplate_updatedAt_idx" ON "FreeTextTemplate"("updatedAt");

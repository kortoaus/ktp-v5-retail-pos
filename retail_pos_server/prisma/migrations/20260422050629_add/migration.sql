-- CreateTable
CREATE TABLE "DocCounter" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocCounter_date_key" ON "DocCounter"("date");

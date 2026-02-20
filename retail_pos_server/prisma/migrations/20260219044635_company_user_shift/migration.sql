-- CreateTable
CREATE TABLE "Company" (
    "id" INTEGER NOT NULL,
    "cloudId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "suburb" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "abn" TEXT,
    "website" TEXT,
    "email" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalShift" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "dayStr" TEXT NOT NULL,
    "openedUserId" INTEGER NOT NULL,
    "openedUser" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedNote" TEXT,
    "closedUserId" INTEGER,
    "closedUser" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "startedCach" INTEGER NOT NULL DEFAULT 0,
    "endedCashExpected" INTEGER NOT NULL DEFAULT 0,
    "endedCashActual" INTEGER NOT NULL DEFAULT 0,
    "salesCash" INTEGER NOT NULL DEFAULT 0,
    "salesCredit" INTEGER NOT NULL DEFAULT 0,
    "totalCashIn" INTEGER NOT NULL DEFAULT 0,
    "totalCashOut" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),
    "synced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TerminalShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_cloudId_key" ON "Company"("cloudId");

-- AddForeignKey
ALTER TABLE "TerminalShift" ADD CONSTRAINT "TerminalShift_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

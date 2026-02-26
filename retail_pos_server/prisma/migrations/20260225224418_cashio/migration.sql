-- AlterTable
ALTER TABLE "TerminalShift" ADD COLUMN     "cashIn" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cashOut" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CashInOut" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashInOut_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CashInOut" ADD CONSTRAINT "CashInOut_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "TerminalShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashInOut" ADD CONSTRAINT "CashInOut_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashInOut" ADD CONSTRAINT "CashInOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

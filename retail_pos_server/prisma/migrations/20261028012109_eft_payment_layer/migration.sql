-- CreateEnum
CREATE TYPE "EftTransactionKind" AS ENUM ('PURCHASE', 'REFUND');

-- CreateEnum
CREATE TYPE "EftTransactionStatus" AS ENUM ('CREATING', 'PENDING', 'AWAITING_POS', 'FINALISED', 'TIMEOUT', 'FAILED', 'FINALISED_BY_OVERRIDE', 'CANCELLED_BY_OVERRIDE');

-- CreateEnum
CREATE TYPE "EftFinancialStatus" AS ENUM ('APPROVED', 'DECLINED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EftErrorClass" AS ENUM ('NET', 'PAIR', 'TERM', 'BANK', 'TIMEOUT', 'POS');

-- CreateEnum
CREATE TYPE "EftOverrideAnswer" AS ENUM ('YES', 'NO');

-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "eftPairingId" INTEGER;

-- CreateTable
CREATE TABLE "EftPairing" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "signingSecretPartBEnc" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tid" TEXT,
    "pairingNickname" TEXT,
    "terminalNickname" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "lastSciOkAt" TIMESTAMP(3),
    "lastSciErrorAt" TIMESTAMP(3),
    "lastSciErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EftPairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EftTransaction" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eftPairingId" INTEGER NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "providerTxnId" TEXT,
    "providerVersion" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" "EftTransactionKind" NOT NULL,
    "requestedCents" INTEGER NOT NULL,
    "surchargeCents" INTEGER NOT NULL DEFAULT 0,
    "operationId" TEXT NOT NULL,
    "saleOperationId" TEXT NOT NULL,
    "invoiceId" INTEGER,
    "status" "EftTransactionStatus" NOT NULL DEFAULT 'CREATING',
    "message" TEXT,
    "financialStatus" "EftFinancialStatus",
    "resultAmounts" JSONB,
    "merchantReceipt" TEXT,
    "customerReceipt" TEXT,
    "cardDetails" JSONB,
    "posInstructions" JSONB,
    "merchantPrintSeq" INTEGER NOT NULL DEFAULT 0,
    "customerPrintSeq" INTEGER NOT NULL DEFAULT 0,
    "errorClass" "EftErrorClass",
    "errorCode" TEXT,
    "overrideAnswer" "EftOverrideAnswer",
    "overrideBy" INTEGER,
    "overrideAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "retiredAt" TIMESTAMP(3),
    "providerData" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EftTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EftEvent" (
    "id" SERIAL NOT NULL,
    "transactionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "httpMethod" TEXT,
    "httpPath" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "providerVersion" INTEGER,
    "statusBefore" TEXT,
    "statusAfter" TEXT,
    "errorClass" "EftErrorClass",
    "errorCode" TEXT,
    "detail" JSONB,

    CONSTRAINT "EftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EftPairing_provider_pairingId_key" ON "EftPairing"("provider", "pairingId");

-- CreateIndex
CREATE INDEX "EftTransaction_terminalId_createdAt_idx" ON "EftTransaction"("terminalId", "createdAt");

-- CreateIndex
CREATE INDEX "EftTransaction_status_idx" ON "EftTransaction"("status");

-- CreateIndex
CREATE INDEX "EftTransaction_providerTxnId_idx" ON "EftTransaction"("providerTxnId");

-- CreateIndex
CREATE INDEX "EftTransaction_saleOperationId_idx" ON "EftTransaction"("saleOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "EftTransaction_operationId_kind_key" ON "EftTransaction"("operationId", "kind");

-- CreateIndex
CREATE INDEX "EftEvent_at_idx" ON "EftEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX "EftEvent_transactionId_seq_key" ON "EftEvent"("transactionId", "seq");

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_eftPairingId_fkey" FOREIGN KEY ("eftPairingId") REFERENCES "EftPairing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EftTransaction" ADD CONSTRAINT "EftTransaction_eftPairingId_fkey" FOREIGN KEY ("eftPairingId") REFERENCES "EftPairing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EftTransaction" ADD CONSTRAINT "EftTransaction_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EftTransaction" ADD CONSTRAINT "EftTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EftEvent" ADD CONSTRAINT "EftEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "EftTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

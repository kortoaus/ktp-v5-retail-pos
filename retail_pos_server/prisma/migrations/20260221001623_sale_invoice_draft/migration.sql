-- CreateTable
CREATE TABLE "SaleInvoice" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'sale',
    "serialNumber" TEXT,
    "original_invoice_id" INTEGER,
    "companyId" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "abn" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "suburb" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "memberId" INTEGER,
    "memberLevel" INTEGER,
    "terminalId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "documentDiscountAmount" DECIMAL(18,2) NOT NULL,
    "creditSurchargeAmount" DECIMAL(18,2) NOT NULL,
    "rounding" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "cashPaid" DECIMAL(18,2) NOT NULL,
    "cashChange" DECIMAL(18,2) NOT NULL,
    "creditPaid" DECIMAL(18,2) NOT NULL,
    "totalDiscountAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SaleInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInvoiceRow" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "uom" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "barcodePrice" DECIMAL(18,2),
    "unit_price_original" DECIMAL(18,2) NOT NULL,
    "unit_price_discounted" DECIMAL(18,2),
    "unit_price_adjusted" DECIMAL(18,2),
    "unit_price_effective" DECIMAL(18,2) NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "measured_weight" DECIMAL(18,3),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "original_invoice_id" INTEGER,
    "original_invoice_row_id" INTEGER,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "adjustments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleInvoiceRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleInvoice_serialNumber_key" ON "SaleInvoice"("serialNumber");

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "TerminalShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoiceRow" ADD CONSTRAINT "SaleInvoiceRow_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

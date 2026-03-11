-- CreateTable
CREATE TABLE "CloudHotkey" (
    "id" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-black',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudHotkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudHotkeyItem" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "hotkeyId" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-black',
    "page" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CloudHotkeyItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CloudHotkeyItem" ADD CONSTRAINT "CloudHotkeyItem_hotkeyId_fkey" FOREIGN KEY ("hotkeyId") REFERENCES "CloudHotkey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

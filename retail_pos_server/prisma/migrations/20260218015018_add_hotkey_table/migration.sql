-- CreateTable
CREATE TABLE "Hotkey" (
    "id" SERIAL NOT NULL,
    "sort" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Hotkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotkeyItem" (
    "id" SERIAL NOT NULL,
    "hotkeyId" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HotkeyItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "HotkeyItem" ADD CONSTRAINT "HotkeyItem_hotkeyId_fkey" FOREIGN KEY ("hotkeyId") REFERENCES "Hotkey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

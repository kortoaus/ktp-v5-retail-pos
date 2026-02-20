-- AlterTable
ALTER TABLE "Hotkey" ADD COLUMN     "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-black';

-- AlterTable
ALTER TABLE "HotkeyItem" ADD COLUMN     "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-black';

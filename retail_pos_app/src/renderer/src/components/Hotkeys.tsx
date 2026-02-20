import { useEffect, useMemo, useState } from "react";
import { Hotkey, HotkeyItem, Item } from "../types/models";
import { itemNameParser } from "../libs/item-utils";
import { cn } from "../libs/cn";

const SIZE = 6;

export const HOTKEY_COLORS = [
  "bg-white text-black",
  "bg-gray-100 text-black",
  "bg-red-500 text-white",
  "bg-orange-500 text-white",
  "bg-yellow-500 text-black",
  "bg-green-500 text-white",
  "bg-blue-500 text-white",
  "bg-purple-500 text-white",
];

export default function Hotkeys({
  hotkeys,
  onItemClick,
}: {
  hotkeys: Hotkey[];
  onItemClick: (x: number, y: number, item: Item | null) => void;
}) {
  const [selectedHotkeyId, setSelectedHotkeyId] = useState<number | null>(
    hotkeys[0]?.id ?? null,
  );

  useEffect(() => {
    if (selectedHotkeyId !== null) return;
    if (hotkeys.length > 0) {
      setSelectedHotkeyId(hotkeys[0].id);
    }
  }, [hotkeys, selectedHotkeyId]);

  const selectedHotkey = useMemo(() => {
    return hotkeys.find((hk) => hk.id === selectedHotkeyId) ?? null;
  }, [hotkeys, selectedHotkeyId]);

  if (hotkeys.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        No hotkeys configured
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col divide-y divide-gray-200">
      {/* Tabs */}
      <div className="h-14 flex items-center divide-x divide-gray-200 shrink-0">
        {hotkeys.map((hotkey) => {
          const isActive = hotkey.id === selectedHotkeyId;
          return (
            <div
              key={hotkey.id}
              onPointerDown={() => setSelectedHotkeyId(hotkey.id)}
              className={cn(
                "h-full flex-1 flex items-center justify-center text-base font-medium",
                hotkey.color,
                isActive ? "font-bold text-lg" : cn("active:opacity-50"),
              )}
            >
              {hotkey.name}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 flex flex-col divide-y divide-gray-200">
        {Array.from({ length: SIZE }).map((_, yIdx) => (
          <div key={yIdx} className="flex-1 flex divide-x divide-gray-200">
            {Array.from({ length: SIZE }).map((_, xIdx) => {
              const hotkeyItem = selectedHotkey?.keys.find(
                (key) => key.x === xIdx && key.y === yIdx,
              );
              return (
                <div
                  key={xIdx}
                  className="flex-1 overflow-hidden"
                  onPointerDown={() => {
                    onItemClick(xIdx, yIdx, hotkeyItem?.item ?? null);
                  }}
                >
                  {hotkeyItem ? (
                    <HotkeyItemCell item={hotkeyItem} />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HotkeyItemCell({ item }: { item: HotkeyItem }) {
  const displayName = item.name || getItemDisplayName(item);
  return (
    <div
      className={cn(
        "w-full h-full flex items-center justify-center text-center p-1 text-xs font-medium leading-tight",
        item.color || "bg-gray-100 text-black",
      )}
    >
      <span className="line-clamp-2">{displayName}</span>
    </div>
  );
}

function getItemDisplayName(hotkeyItem: HotkeyItem): string {
  if (!hotkeyItem.item) return `Item #${hotkeyItem.itemId}`;
  const { name_en, name_ko } = itemNameParser(hotkeyItem.item);
  return name_en || name_ko;
}

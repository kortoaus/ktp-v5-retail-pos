import { useMemo, useState } from "react";
import { Hotkey, HotkeyItem, Item } from "../types/models";
import { itemNameParser } from "../libs/item-utils";

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
  const [selectedHotKeyId, setSelectedHotKeyId] = useState<number | null>(
    hotkeys[0]?.id ?? null,
  );

  const selectedHotkey = useMemo(() => {
    return hotkeys.find((hotkey) => hotkey.id === selectedHotKeyId) ?? null;
  }, [hotkeys, selectedHotKeyId]);

  return (
    <div className="h-full flex flex-col divide-y divide-gray-200">
      {/* Section */}
      <div className="h-14 flex items-center divide-x divide-gray-200 *:h-full *:flex-1 bg-blue-100">
        {hotkeys.map((hotkey) => {
          return (
            <div key={hotkey.id} onClick={() => setSelectedHotKeyId(hotkey.id)}>
              {hotkey.name}
            </div>
          );
        })}
        <button>Add Hotkey</button>
      </div>
      {/* Keys */}
      <div className="flex-1 flex flex-col divide-y divide-gray-200">
        {Array.from({ length: SIZE }).map((_, yIdx) => {
          return (
            <div key={yIdx} className="flex-1 flex divide-x divide-gray-200">
              {Array.from({ length: SIZE }).map((_, xIdx) => {
                const selectedHotkeyItem = selectedHotkey?.keys.find(
                  (key) => key.x === xIdx && key.y === yIdx,
                );
                return (
                  <div
                    key={xIdx}
                    className="flex-1 overflow-hidden"
                    onClick={() => {
                      onItemClick(xIdx, yIdx, null);
                    }}
                  >
                    {selectedHotkeyItem && (
                      <HotkeyItem
                        item={selectedHotkeyItem}
                        onClick={() => {
                          onItemClick(
                            xIdx,
                            yIdx,
                            selectedHotkeyItem.item || null,
                          );
                        }}
                      />
                    )}
                    {!selectedHotkeyItem && (
                      <div className="w-full h-full center">
                        {`${xIdx}, ${yIdx}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HotkeyItem({
  item,
  onClick,
}: {
  item: HotkeyItem;
  onClick: () => void;
}) {
  const { name } = item;
  const { name_en, name_ko } = itemNameParser(item.item);
  return (
    <div className="w-full h-full center">{name || name_en || name_ko}</div>
  );
}

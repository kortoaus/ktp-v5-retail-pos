import { useCallback, useRef, useState } from "react";
import { Item } from "../types/models";
import { PagingType } from "../libs/api";
import { searchItemsByKeyword } from "../service/item.service";
import { cn } from "../libs/cn";
import KeyboardInputText from "./KeyboardInputText";
import { FaArrowDown, FaArrowUp } from "react-icons/fa6";

export default function SearchItemList({
  selectedItemId,
  selectedItemIds,
  onSelect,
  listSize = 10,
}: {
  selectedItemId: number | null;
  selectedItemIds: number[] | null;
  onSelect: (item: Item) => void;
  listSize?: number;
}) {
  const [result, setResult] = useState<Item[]>([]);
  const [keyword, setKeyword] = useState("");
  const [paging, setPaging] = useState<PagingType | null>(null);
  const pageRef = useRef(1);

  const fetchItems = useCallback(
    async (page: number) => {
      pageRef.current = page;
      const res = await searchItemsByKeyword(keyword, page, listSize);
      if (res.ok && res.result) {
        setResult(res.result);
        setPaging(res.paging);
      }
    },
    [keyword, listSize],
  );

  const handleSearch = useCallback(() => {
    pageRef.current = 1;
    fetchItems(1);
  }, [fetchItems]);

  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="h-12 flex items-center gap-2 p-2 bg-blue-100">
        <KeyboardInputText
          className="flex-1 bg-white"
          value={keyword}
          onChange={setKeyword}
          onEnter={handleSearch}
        />
        <button
          onPointerDown={handleSearch}
          className="rounded-lg bg-gray-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors shrink-0"
        >
          Search
        </button>
      </div>

      <div
        className="flex-1 overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${listSize}, 1fr)`,
        }}
      >
        {Array.from({ length: listSize }).map((_, i) => {
          const item = result[i];
          if (!item) return <div key={i} />;
          const selected =
            selectedItemId === item.id || selectedItemIds?.includes(item.id);
          return (
            <div
              key={item.id}
              onPointerDown={() => onSelect(item)}
              className={cn(
                "flex items-center px-3 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden",
                selected && "bg-blue-50",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {item.name_en}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {item.barcode}
                  {item.name_ko ? ` · ${item.name_ko}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-12 grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-200">
        <button
          disabled={!hasPrev}
          onPointerDown={() => hasPrev && fetchItems(pageRef.current - 1)}
          className={cn(
            "flex items-center justify-center bg-slate-500 text-white text-sm",
            !hasPrev && "opacity-50",
          )}
        >
          <FaArrowUp />
        </button>
        <button
          disabled={!hasNext}
          onPointerDown={() => hasNext && fetchItems(pageRef.current + 1)}
          className={cn(
            "flex items-center justify-center bg-slate-500 text-white text-sm",
            !hasNext && "opacity-50",
          )}
        >
          <FaArrowDown />
        </button>
      </div>
    </div>
  );
}

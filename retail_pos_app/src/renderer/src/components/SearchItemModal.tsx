import { useCallback, useEffect, useState } from "react";
import { Item } from "../types/models";
import { searchItemsByKeyword } from "../service/item.service";
import { itemNameParser } from "../libs/item-utils";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { PagingType } from "../libs/api";
import { MONEY_DP } from "../libs/constants";

const ITEMS_PER_PAGE = 5;

interface SearchItemModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: Item) => void;
}

export default function SearchItemModal({
  open,
  onClose,
  onSelect,
}: SearchItemModalProps) {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const search = useCallback(
    async (searchKeyword: string, searchPage: number) => {
      const trimmed = searchKeyword.trim();
      if (!trimmed) {
        setItems([]);
        setPaging(null);
        return;
      }

      setLoading(true);
      try {
        const res = await searchItemsByKeyword(
          trimmed,
          searchPage,
          ITEMS_PER_PAGE,
        );
        if (res.ok && res.result) {
          setItems(res.result);
          setPaging(res.paging);
        } else {
          setItems([]);
          setPaging(null);
        }
      } catch {
        setItems([]);
        setPaging(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleEnter = useCallback(() => {
    setPage(1);
    search(keyword, 1);
  }, [keyword, search]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage < 1) return;
      if (paging && newPage > paging.totalPages) return;
      setPage(newPage);
      search(keyword, newPage);
    },
    [keyword, search, paging],
  );

  const handleSelect = useCallback(
    (item: Item) => {
      onSelect(item);
      setKeyword("");
      setItems([]);
      setPaging(null);
      setPage(1);
    },
    [onSelect],
  );

  const handleClose = useCallback(() => {
    setKeyword("");
    setItems([]);
    setPaging(null);
    setPage(1);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setItems([]);
    setPaging(null);
    setPage(1);
  }, [open]);

  if (!open) return null;

  const emptySlots = ITEMS_PER_PAGE - items.length;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Search Item</h2>
          <button
            type="button"
            onPointerDown={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
            <span className="text-gray-400 text-lg">🔍</span>
            <div className="flex-1 text-lg min-h-[28px]">
              {keyword || (
                <span className="text-gray-400">Type and press Enter</span>
              )}
            </div>
            {loading && (
              <span className="text-sm text-gray-400">Loading...</span>
            )}
            {keyword && !loading && (
              <button
                type="button"
                onPointerDown={() => setKeyword("")}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div>
          {items.length === 0 && !loading && (
            <div className="flex items-center justify-center text-gray-400 min-h-48">
              {keyword.trim() ? "No items found" : "Enter keyword to search"}
            </div>
          )}
          {items.length > 0 && (
            <>
              {items.map((item) => {
                const { name_en, name_ko } = itemNameParser(item);
                const price = item.price?.prices[0] ?? 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onPointerDown={() => handleSelect(item)}
                    className="w-full text-left px-4 h-14 border-b border-gray-100 active:bg-blue-50 flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-sm">
                        {name_en}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {name_ko}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">
                      {item.barcode}
                    </div>
                    <div className="text-right shrink-0 w-20">
                      <div className="font-bold text-sm">
                        ${price.toFixed(MONEY_DP)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {emptySlots > 0 && <div style={{ height: emptySlots * 64 }} />}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200">
          <button
            type="button"
            disabled={!paging?.hasPrev}
            onPointerDown={() => handlePageChange(page - 1)}
            className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm font-medium min-w-[80px]"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">
            {paging ? `${paging.currentPage} / ${paging.totalPages}` : "— / —"}
          </span>
          <button
            type="button"
            disabled={!paging?.hasNext}
            onPointerDown={() => handlePageChange(page + 1)}
            className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm font-medium min-w-[80px]"
          >
            Next →
          </button>
        </div>

        <div className="border-t border-gray-200 p-2">
          <OnScreenKeyboard
            value={keyword}
            onChange={setKeyword}
            onEnter={handleEnter}
          />
        </div>
      </div>
    </div>
  );
}

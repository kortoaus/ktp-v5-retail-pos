import { useCallback, useEffect, useRef, useState } from "react";
import KeyboardInputText from "../../components/KeyboardInputText";
import { CF_URL } from "../../libs/cf-image-utils";
import { cn } from "../../libs/cn";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import { itemNameParser } from "../../libs/item-utils";
import { applyBrowsePage, initialBrowseListState } from "../../libs/scale-browse-page-policy";
import type { RecentItemEntry } from "../../libs/scale-recent-items";
import { searchScaleItemsByKeyword } from "../../service/item.service";
import { Brand, Item } from "../../types/models";
import BrandFilterModal from "./BrandFilterModal";
import RecentItemsRow from "./RecentItemsRow";

const PAGE_SIZE = 12;
type BrowseQuery = { keyword: string; brandId: number | null };

export default function ItemBrowsePanel({ onPick, recentItems }: {
  onPick: (itemId: number) => void;
  recentItems: RecentItemEntry[];
}) {
  const [keyword, setKeyword] = useState("");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const [list, setList] = useState(initialBrowseListState<Item>);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);
  const queryRef = useRef<BrowseQuery>({ keyword: "", brandId: null });
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async (page: number, query: BrowseQuery, append: boolean) => {
    const requestId = ++requestIdRef.current;
    busyRef.current = true;
    setLoading(!append);
    setLoadingMore(append);
    if (!append) {
      queryRef.current = query;
      setList(initialBrowseListState<Item>());
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
    const res = await searchScaleItemsByKeyword(query.keyword, page, PAGE_SIZE, query.brandId);
    // Ignore superseded searches and responses from a closed panel. No cache or
    // prefetch survives a remount; returning from weighing keeps this panel alive.
    if (requestId !== requestIdRef.current) return;
    setList((previous) => applyBrowsePage(previous, { append, page }, {
      ok: res.ok, result: res.result,
      msg: res.msg || "Unable to load scale items.", hasNext: res.paging?.hasNext,
    }));
    busyRef.current = false;
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    void fetchItems(1, { keyword: "", brandId: null }, false);
    return () => { ++requestIdRef.current; };
  }, [fetchItems]);

  const search = (nextBrand: Brand | null = brand) => {
    void fetchItems(1, { keyword: keyword.trim(), brandId: nextBrand?.id ?? null }, false);
  };
  const loadMore = () => {
    if (busyRef.current || !list.hasMore) return;
    // Paging and retries use the submitted query, even if the input was edited.
    void fetchItems(list.page + 1, queryRef.current, true);
  };

  return (
    <div className="h-full w-full flex flex-col bg-gray-100">
      <div className="h-14 shrink-0 flex items-center gap-2 px-3 bg-white border-b border-gray-200">
        <KeyboardInputText
          className="flex-1 max-w-md bg-white"
          value={keyword}
          onChange={setKeyword}
          onEnter={() => search()}
          placeholder="Name or barcode"
          initialLayout="english"
        />
        <div
          role="button"
          onPointerDown={() => search()}
          className="h-9 flex items-center rounded-lg bg-gray-600 px-4 text-sm font-medium text-white active:bg-gray-700 shrink-0 cursor-pointer"
        >
          Search
        </div>
        <div
          role="button"
          onPointerDown={() => setBrandOpen(true)}
          className={cn(
            "h-9 flex items-center rounded-lg border px-4 text-sm font-medium shrink-0 max-w-[220px] cursor-pointer",
            brand ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 bg-white text-gray-600",
          )}
        >
          <span className="truncate">{brand ? brand.name_en || brand.name_ko : "All brands"}</span>
        </div>
        {brand && (
          <div
            role="button"
            onPointerDown={() => { setBrand(null); search(null); }}
            className="h-9 flex items-center px-2 text-sm font-medium text-red-600 shrink-0 cursor-pointer"
          >
            Clear
          </div>
        )}
      </div>

      <RecentItemsRow items={recentItems} onPick={onPick} />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading items…</div>
        ) : list.error !== null ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <p role="alert" className="text-sm text-red-700">{list.error}</p>
            <div
              role="button"
              onPointerDown={() => {
                if (!busyRef.current) void fetchItems(1, queryRef.current, false);
              }}
              className="h-12 px-6 flex items-center rounded-lg bg-blue-600 text-sm font-semibold text-white cursor-pointer active:bg-blue-700"
            >
              Retry search
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              {list.items.map((item) => <ItemCard key={item.id} item={item} onPick={onPick} />)}
            </div>
            {list.items.length === 0 && (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">
                No scale items match this search.
              </div>
            )}
          </>
        )}
      </div>

      {!loading && list.hasMore && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-white border-t border-gray-200">
          {list.loadMoreError !== null && (
            <p role="alert" className="flex-1 text-sm text-red-700">{list.loadMoreError}</p>
          )}
          <div
            role="button"
            aria-disabled={loadingMore}
            onPointerDown={loadMore}
            className={cn(
              "h-11 flex-1 flex items-center justify-center rounded-lg bg-slate-500 text-sm font-semibold text-white cursor-pointer",
              loadingMore && "opacity-40",
            )}
          >
            {loadingMore ? "Loading…" : list.loadMoreError !== null ? "Retry load more" : "Load more"}
          </div>
        </div>
      )}

      <BrandFilterModal
        open={brandOpen}
        onClose={() => setBrandOpen(false)}
        selected={brand}
        onSelect={(next) => { setBrand(next); search(next); }}
      />
    </div>
  );
}

function ItemCard({ item, onPick }: { item: Item; onPick: (itemId: number) => void }) {
  const { name_en, name_ko } = itemNameParser(item);
  const price = item.promoPrice?.prices[0] ?? item.price?.prices[0] ?? 0;
  const hasPromo = item.promoPrice != null;
  const fixed = item.scaleData?.isFixedWeight ?? false;

  return (
    // A `div` tap target, not a `<button>`: the HID scanner appends Enter, and
    // a focused button would fire on the next scan. Same rule PaymentModal and
    // CloudHotkeyViewerV2 follow — do not "fix" this into a button.
    <div
      onPointerDown={() => onPick(item.id)}
      className="h-40 rounded-xl border border-gray-200 bg-white p-2 flex flex-col cursor-pointer active:border-blue-500 active:bg-blue-50 overflow-hidden"
    >
      <div className="h-16 shrink-0 flex items-center justify-center overflow-hidden rounded-lg bg-gray-50">
        {item.thumb ? (
          <img
            src={CF_URL(item.thumb, "thumb")}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-2xl text-gray-300">⚖</span>
        )}
      </div>
      <div className="mt-1 flex-1 min-h-0">
        <div className="text-sm font-semibold leading-tight line-clamp-2">{name_en}</div>
        <div className="text-xs text-gray-400 truncate">{name_ko}</div>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase text-gray-400">
          {fixed ? "Fixed" : "Weigh"}
        </span>
        <span
          className={cn(
            "text-sm font-bold tabular-nums",
            hasPromo ? "text-red-500" : "text-gray-800",
          )}
        >
          ${(price / MONEY_SCALE).toFixed(MONEY_DP)}
        </span>
      </div>
    </div>
  );
}

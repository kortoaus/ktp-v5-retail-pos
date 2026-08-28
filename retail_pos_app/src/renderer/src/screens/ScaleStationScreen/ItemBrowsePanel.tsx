import { useCallback, useEffect, useRef, useState } from "react";
import KeyboardInputText from "../../components/KeyboardInputText";
import { PagingType } from "../../libs/api";
import { CF_URL } from "../../libs/cf-image-utils";
import { cn } from "../../libs/cn";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import { itemNameParser } from "../../libs/item-utils";
import { searchScaleItemsByKeyword } from "../../service/item.service";
import { Brand, Item } from "../../types/models";
import BrandFilterModal from "./BrandFilterModal";

/**
 * The `/scale` station's item browser: keyword and/or brand, tap to weigh.
 *
 * A grid rather than the `SearchItemList` row list the price-tag screens use.
 * Weighing is a two-tap job an operator repeats all day and often knows the
 * product by its picture, not its barcode — so this trades density for target
 * size and a thumbnail. It searches `/api/item/search/keyword/scale`, which
 * filters to `isScale` items; there is nothing to weigh outside that set.
 */

const PAGE_SIZE = 12;

export default function ItemBrowsePanel({
  onPick,
}: {
  onPick: (item: Item) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const pageRef = useRef(1);

  const fetchItems = useCallback(
    async (page: number, kw: string, brandId: number | null) => {
      pageRef.current = page;
      setLoading(true);
      const res = await searchScaleItemsByKeyword(kw, page, PAGE_SIZE, brandId);
      if (res.ok && res.result) {
        setItems(res.result);
        setPaging(res.paging);
      } else {
        setItems([]);
        setPaging(null);
      }
      setSearched(true);
      setLoading(false);
    },
    [],
  );

  // First paint lists the scale catalogue rather than an empty grid — with no
  // keyword the route returns every `isScale` item, which is a usable menu.
  useEffect(() => {
    void fetchItems(1, "", null);
  }, [fetchItems]);

  const search = useCallback(
    (page: number) => void fetchItems(page, keyword, brand?.id ?? null),
    [fetchItems, keyword, brand],
  );

  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

  return (
    <div className="h-full w-full flex flex-col bg-gray-100">
      <div className="h-14 shrink-0 flex items-center gap-2 px-3 bg-white border-b border-gray-200">
        <KeyboardInputText
          className="flex-1 max-w-md bg-white"
          value={keyword}
          onChange={setKeyword}
          onEnter={() => search(1)}
          placeholder="Name or barcode"
        />
        <button
          type="button"
          onPointerDown={() => search(1)}
          className="h-9 rounded-lg bg-gray-600 px-4 text-sm font-medium text-white active:bg-gray-700 shrink-0"
        >
          Search
        </button>
        <button
          type="button"
          onPointerDown={() => setBrandOpen(true)}
          className={cn(
            "h-9 rounded-lg border px-4 text-sm font-medium shrink-0 max-w-[220px] truncate",
            brand
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-600",
          )}
        >
          {brand ? brand.name_en || brand.name_ko : "All brands"}
        </button>
        {brand && (
          <button
            type="button"
            onPointerDown={() => {
              setBrand(null);
              void fetchItems(1, keyword, null);
            }}
            className="h-9 px-2 text-sm font-medium text-red-600 shrink-0"
          >
            Clear
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-400 shrink-0">
          {paging ? `Page ${paging.currentPage} / ${paging.totalPages}` : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="grid grid-cols-4 gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onPick={onPick} />
          ))}
        </div>
        {!loading && searched && items.length === 0 && (
          <div className="h-40 flex items-center justify-center text-sm text-gray-400">
            No scale items match this search.
          </div>
        )}
      </div>

      <div className="h-14 shrink-0 grid grid-cols-2 gap-3 px-3 py-2 bg-white border-t border-gray-200">
        <button
          type="button"
          disabled={!hasPrev}
          onPointerDown={() => hasPrev && search(pageRef.current - 1)}
          className={cn(
            "rounded-lg bg-slate-500 text-sm font-semibold text-white",
            !hasPrev && "opacity-40",
          )}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onPointerDown={() => hasNext && search(pageRef.current + 1)}
          className={cn(
            "rounded-lg bg-slate-500 text-sm font-semibold text-white",
            !hasNext && "opacity-40",
          )}
        >
          Next
        </button>
      </div>

      <BrandFilterModal
        open={brandOpen}
        onClose={() => setBrandOpen(false)}
        selected={brand}
        onSelect={(next) => {
          setBrand(next);
          void fetchItems(1, keyword, next?.id ?? null);
        }}
      />
    </div>
  );
}

function ItemCard({ item, onPick }: { item: Item; onPick: (item: Item) => void }) {
  const { name_en, name_ko } = itemNameParser(item);
  const price = item.promoPrice?.prices[0] ?? item.price?.prices[0] ?? 0;
  const hasPromo = item.promoPrice != null;
  const fixed = item.scaleData?.isFixedWeight ?? false;

  return (
    // A `div` tap target, not a `<button>`: the HID scanner appends Enter, and
    // a focused button would fire on the next scan. Same rule PaymentModal and
    // CloudHotkeyViewerV2 follow — do not "fix" this into a button.
    <div
      onPointerDown={() => onPick(item)}
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

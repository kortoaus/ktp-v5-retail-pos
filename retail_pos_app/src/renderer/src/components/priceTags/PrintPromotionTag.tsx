import { useCallback, useMemo, useRef, useState } from "react";
import { Promotion } from "../../types/models";
import { PagingType } from "../../libs/api";
import {
  searchPromotions,
  getPromotionById,
  PromotionDetail,
} from "../../service/promotion.service";
import { buildPromotionTag7090 } from "../../libs/label-templates";
import { LabelPrinter, useZplPrinters } from "../../hooks/useZplPrinters";
import { cn } from "../../libs/cn";
import KeyboardInputText from "../KeyboardInputText";
import { FaArrowDown, FaArrowUp } from "react-icons/fa6";

const LIST_SIZE = 10;

export default function PrintPromotionTag() {
  const [result, setResult] = useState<Promotion[]>([]);
  const [keyword, setKeyword] = useState("");
  const [paging, setPaging] = useState<PagingType | null>(null);
  const pageRef = useRef(1);
  const [selected, setSelected] = useState<PromotionDetail | null>(null);
  const { printLabel, printers } = useZplPrinters();

  const printers7090 = useMemo(
    () => printers.filter((p) => p.mediaSize === "7090"),
    [printers],
  );

  const fetchPromotions = useCallback(
    async (page: number) => {
      pageRef.current = page;
      const res = await searchPromotions(keyword, page, LIST_SIZE);
      if (res.ok && res.result) {
        setResult(res.result);
        setPaging(res.paging);
      }
    },
    [keyword],
  );

  const handleSearch = useCallback(() => {
    pageRef.current = 1;
    fetchPromotions(1);
  }, [fetchPromotions]);

  const handleSelect = useCallback(async (promo: Promotion) => {
    const res = await getPromotionById(promo.id);
    if (res.ok && res.result) {
      setSelected(res.result);
    }
  }, []);

  const handlePrint = (printer: LabelPrinter) => {
    if (!selected) return;
    const label = buildPromotionTag7090(printer.language, {
      name_en: selected.name_en,
      name_ko: selected.name_ko,
      discountType: selected.discountType as "percentage" | "amount",
      discountPercentAmounts: selected.discountPercentAmounts,
      discountFlatAmounts: selected.discountFlatAmounts,
      minQty: selected.minQty,
      maxQty: selected.maxQty ?? null,
      startDate: selected.startDate,
      endDate: selected.endDate,
      allowedItems: selected.allowedItems,
    });
    printLabel(printer, label);
  };

  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

  return (
    <div className="h-full w-full bg-white flex divide-x divide-gray-200">
      <div className="w-[300px] h-full flex flex-col">
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
            gridTemplateRows: `repeat(${LIST_SIZE}, 1fr)`,
          }}
        >
          {Array.from({ length: LIST_SIZE }).map((_, i) => {
            const promo = result[i];
            if (!promo) return <div key={i} />;
            const isSelected = selected?.id === promo.id;
            return (
              <div
                key={promo.id}
                onPointerDown={() => handleSelect(promo)}
                className={cn(
                  "flex items-center px-3 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden",
                  isSelected && "bg-blue-50",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {promo.name_en}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {promo.discountType === "percentage" ? "%" : "$"} OFF
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-12 grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-200">
          <button
            disabled={!hasPrev}
            onPointerDown={() => hasPrev && fetchPromotions(pageRef.current - 1)}
            className={cn(
              "flex items-center justify-center bg-slate-500 text-white text-sm",
              !hasPrev && "opacity-50",
            )}
          >
            <FaArrowUp />
          </button>
          <button
            disabled={!hasNext}
            onPointerDown={() => hasNext && fetchPromotions(pageRef.current + 1)}
            className={cn(
              "flex items-center justify-center bg-slate-500 text-white text-sm",
              !hasNext && "opacity-50",
            )}
          >
            <FaArrowDown />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <div className="text-lg font-bold">{selected.name_en}</div>
              <div className="text-sm text-gray-600">{selected.name_ko}</div>

              <div className="text-sm">
                <span className="font-medium">Discount: </span>
                {selected.discountType === "percentage"
                  ? `${(selected.discountPercentAmounts[0] ?? 0) / 10}% OFF`
                  : `$${((selected.discountFlatAmounts[0] ?? 0) / 100).toFixed(2)} OFF`}
              </div>

              {selected.minQty > 1 && (
                <div className="text-sm">
                  <span className="font-medium">Min Qty: </span>
                  {selected.minQty / 1000}
                </div>
              )}

              {selected.maxQty != null && (
                <div className="text-sm">
                  <span className="font-medium">Cap: </span>
                  {selected.maxQty / 1000}
                </div>
              )}

              {selected.allowedItems.length > 0 && (
                <div className="text-sm">
                  <span className="font-medium">
                    Allowed Items ({selected.allowedItems.length}):
                  </span>
                  <ul className="mt-1 space-y-0.5 text-gray-600">
                    {selected.allowedItems.map((item) => (
                      <li key={item.id}>- {item.name_en}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 space-y-2">
              {printers7090.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {printers7090.map((p) => (
                    <button
                      key={p.name}
                      onPointerDown={() => handlePrint(p)}
                      className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400">
                  No 7090 printers configured.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Search and select a promotion
          </div>
        )}
      </div>
    </div>
  );
}

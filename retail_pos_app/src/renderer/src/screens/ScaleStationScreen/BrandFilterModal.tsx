import { useCallback, useEffect, useRef, useState } from "react";
import ModalContainer from "../../components/ModalContainer";
import KeyboardInputText from "../../components/KeyboardInputText";
import { cn } from "../../libs/cn";
import { PagingType } from "../../libs/api";
import { searchBrands } from "../../service/brand.service";
import { Brand } from "../../types/models";

const PAGE_SIZE = 12;

/**
 * Brand picker for the `/scale` item browser.
 *
 * `GET /api/brand/search` had no consumer in this app until now (the repo
 * `CLAUDE.md` lists it under "unused surface"), so this is the first screen to
 * read it. Keyword is optional — an empty search lists every brand, which is
 * how an operator who does not know the spelling finds one.
 */
export default function BrandFilterModal({
  open,
  onClose,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  selected: Brand | null;
  onSelect: (brand: Brand | null) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const pageRef = useRef(1);

  const fetchBrands = useCallback(
    async (page: number, kw: string) => {
      pageRef.current = page;
      setLoading(true);
      const res = await searchBrands(kw, page, PAGE_SIZE);
      if (res.ok && res.result) {
        setBrands(res.result);
        setPaging(res.paging);
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    void fetchBrands(1, "");
  }, [open, fetchBrands]);

  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

  return (
    <ModalContainer open={open} onClose={onClose} title="Brand" maxWidth="max-w-2xl">
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyboardInputText
            className="flex-1 bg-white"
            value={keyword}
            onChange={setKeyword}
            onEnter={() => void fetchBrands(1, keyword)}
            placeholder="Brand name"
          />
          <button
            type="button"
            onPointerDown={() => void fetchBrands(1, keyword)}
            className="h-9 rounded-lg bg-gray-600 px-4 text-sm font-medium text-white active:bg-gray-700 shrink-0"
          >
            Search
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 min-h-[260px] content-start">
          <button
            type="button"
            onPointerDown={() => {
              onSelect(null);
              onClose();
            }}
            className={cn(
              "h-14 rounded-lg border px-2 text-sm font-semibold transition-colors",
              selected == null
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600",
            )}
          >
            All brands
          </button>
          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              onPointerDown={() => {
                onSelect(brand);
                onClose();
              }}
              className={cn(
                "h-14 rounded-lg border px-2 text-sm font-semibold transition-colors overflow-hidden",
                selected?.id === brand.id
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600",
              )}
            >
              <div className="truncate">{brand.name_en || brand.name_ko}</div>
              {brand.name_ko && brand.name_en && (
                <div className="truncate text-xs font-normal text-gray-400">
                  {brand.name_ko}
                </div>
              )}
            </button>
          ))}
          {!loading && brands.length === 0 && (
            <div className="col-span-3 flex items-center justify-center text-sm text-gray-400">
              No brands found.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onPointerDown={() => hasPrev && void fetchBrands(pageRef.current - 1, keyword)}
            className={cn(
              "h-11 rounded-lg bg-slate-500 text-sm font-medium text-white",
              !hasPrev && "opacity-40",
            )}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onPointerDown={() => hasNext && void fetchBrands(pageRef.current + 1, keyword)}
            className={cn(
              "h-11 rounded-lg bg-slate-500 text-sm font-medium text-white",
              !hasNext && "opacity-40",
            )}
          >
            Next
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

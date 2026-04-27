import { useCallback, useRef, useState } from "react";
import { FaArrowDown, FaArrowUp } from "react-icons/fa6";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import dayjsAU from "../../libs/dayjsAU";
import { getCloudLabelUpdateSheets } from "../../service/cloud.service";
import { CloudItemSheet } from "../../types/models";
import KeyboardInputText from "../KeyboardInputText";

export default function SearchItemSheetList({
  selectedSheetId,
  selectedSheetIds,
  printedSheetIds,
  onSelect,
  listSize = 10,
}: {
  selectedSheetId: number | null;
  selectedSheetIds: number[] | null;
  printedSheetIds?: Set<number>;
  onSelect: (sheet: CloudItemSheet) => void;
  listSize?: number;
}) {
  const [result, setResult] = useState<CloudItemSheet[]>([]);
  const [keyword, setKeyword] = useState("");
  const [paging, setPaging] = useState<PagingType | null>(null);
  const pageRef = useRef(1);

  const fetchSheets = useCallback(
    async (page: number) => {
      pageRef.current = page;
      const params = new URLSearchParams({
        keyword,
        page: String(page),
        limit: String(listSize),
      });
      const qs = `?${params.toString()}`;
      const res = await getCloudLabelUpdateSheets(qs);
      if (res.ok && res.result) {
        setResult(res.result);
        setPaging(res.paging);
      }
    },
    [keyword, listSize],
  );

  const handleSearch = useCallback(() => {
    pageRef.current = 1;
    fetchSheets(1);
  }, [fetchSheets]);

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
          const sheet = result[i];
          if (!sheet) return <div key={i} />;
          const selected =
            selectedSheetId === sheet.id ||
            selectedSheetIds?.includes(sheet.id);
          const printed = printedSheetIds?.has(sheet.id) ?? false;
          return (
            <div
              key={sheet.id}
              onPointerDown={() => onSelect(sheet)}
              className={cn(
                "flex items-center px-3 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden",
                selected && "bg-blue-50",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium truncate">
                    #{sheet.id} Label Update
                  </div>
                  {printed && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Printed
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {sheet.author} ·{" "}
                  {dayjsAU(sheet.createdAt).format("DD/MM/YYYY hh:mm A")}
                </div>
                {sheet.note && (
                  <div className="text-xs text-gray-400 truncate">
                    {sheet.note}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-12 grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-200">
        <button
          disabled={!hasPrev}
          onPointerDown={() => hasPrev && fetchSheets(pageRef.current - 1)}
          className={cn(
            "flex items-center justify-center bg-slate-500 text-white text-sm",
            !hasPrev && "opacity-50",
          )}
        >
          <FaArrowUp />
        </button>
        <button
          disabled={!hasNext}
          onPointerDown={() => hasNext && fetchSheets(pageRef.current + 1)}
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

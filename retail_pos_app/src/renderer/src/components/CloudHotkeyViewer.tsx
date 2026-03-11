import { useMemo, useState } from "react";
import { CloudHotkey, CloudHotkeyItem, Hotkey } from "../types/models";
import { cn } from "../libs/cn";

interface CloudHotkeyViewerProps {
  hotkeys: CloudHotkey[];
  onItemClick: (barcode: string) => void;
}

const SIZE = 5;

const TabPageSize = SIZE * SIZE;

export default function CloudHotkeyViewer({
  hotkeys,
  onItemClick,
}: CloudHotkeyViewerProps) {
  const [selectedHotkeyId, setSelectedHotkeyId] = useState<number | null>(null);
  const [lang, setLang] = useState<"en" | "ko">("en");

  const currentTab = useMemo(() => {
    return hotkeys.find((hk) => hk.id === selectedHotkeyId) || null;
  }, [selectedHotkeyId]);

  return (
    <div className="w-full h-full">
      {currentTab === null && (
        <TabViewer
          tabs={hotkeys}
          onClick={setSelectedHotkeyId}
          lang={lang}
          toggleLang={() => {
            setLang(lang === "en" ? "ko" : "en");
          }}
        />
      )}
      {currentTab !== null && (
        <KeyViewer
          keys={currentTab.keys}
          onClick={onItemClick}
          onClose={() => setSelectedHotkeyId(null)}
          lang={lang}
        />
      )}
    </div>
  );
}

function TabViewer({
  tabs,
  onClick,
  toggleLang,
  lang,
}: {
  tabs: CloudHotkey[];
  onClick: (id: number) => void;
  toggleLang: () => void;
  lang: "en" | "ko";
}) {
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(tabs.length / TabPageSize);
  const visibleTabs = useMemo(() => {
    return tabs.slice((page - 1) * TabPageSize, page * TabPageSize);
  }, [tabs, page]);

  const hasPrev = page > 1;
  const hasNext = page < maxPage;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 grid grid-cols-5 grid-rows-5">
        {visibleTabs.map((tab) => (
          <div
            onClick={() => onClick(tab.id)}
            key={tab.id}
            className="w-full h-full flex items-center justify-center p-1"
          >
            <div className="border w-full h-full center">
              {lang === "en" ? tab.name_en : tab.name_ko}
            </div>
          </div>
        ))}
      </div>

      {/* Paginator */}
      <div className="h-16 grid grid-cols-3">
        <div
          className={cn(
            "center bg-slate-500 text-white text-xl font-bold",
            hasPrev ? "opacity-100" : "opacity-50",
          )}
          onClick={() => {
            if (hasPrev) {
              setPage(page - 1);
            }
          }}
        >
          Prev
        </div>
        <div
          className="center text-xl font-bold bg-blue-500 text-white"
          onClick={toggleLang}
        >
          {page} / {maxPage}
        </div>
        <div
          className={cn(
            "center bg-slate-500 text-white text-xl font-bold",
            hasNext ? "opacity-100" : "opacity-50",
          )}
          onClick={() => {
            if (hasNext) {
              setPage(page + 1);
            }
          }}
        >
          Next
        </div>
      </div>
    </div>
  );
}

function KeyViewer({
  keys,
  lang,
  onClick,
  onClose,
}: {
  keys: CloudHotkeyItem[];
  onClick: (barcode: string) => void;
  lang: "en" | "ko";
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const hasPrev = page > 1;
  const currentKeys = useMemo(() => {
    return keys.filter((k) => k.page === page);
  }, [keys, page]);

  const hasNext = useMemo(() => {
    console.log(keys.filter((k) => k.page === 2));
    return keys.filter((k) => k.page === page + 1).length > 0;
  }, [page, keys]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 grid grid-cols-5 grid-rows-5 border border-black">
        {Array.from({ length: SIZE * SIZE }).map((_, i) => {
          const xIdx = i % SIZE;
          const yIdx = Math.floor(i / SIZE);
          const keyItem = currentKeys.find((k) => k.x === xIdx && k.y === yIdx);
          if (!keyItem)
            return (
              <div key={`${xIdx},${yIdx}`} className="border border-black" />
            );
          return (
            <KeyCell
              key={`${xIdx},${yIdx}`}
              keyItem={keyItem}
              lang={lang}
              onClick={onClick}
            />
          );
        })}
      </div>

      {/* Paginator */}
      <div className="h-16 grid grid-cols-3">
        <div
          className={cn(
            "center bg-slate-500 text-white text-xl font-bold",
            hasPrev ? "opacity-100" : "opacity-50",
          )}
          onClick={() => {
            if (hasPrev) {
              setPage(page - 1);
            }
          }}
        >
          Prev
        </div>

        <div
          className={cn("center bg-red-500 text-white text-xl font-bold")}
          onClick={onClose}
        >
          Close
        </div>

        <div
          className={cn(
            "center bg-slate-500 text-white text-xl font-bold",
            hasNext ? "opacity-100" : "opacity-50",
          )}
          onClick={() => {
            if (hasNext) {
              setPage(page + 1);
            }
          }}
        >
          Next
        </div>
      </div>
    </div>
  );
}

function KeyCell({
  keyItem,
  lang,
  onClick,
}: {
  keyItem: CloudHotkeyItem;
  lang: "en" | "ko";
  onClick: (barcode: string) => void;
}) {
  const { item, color } = keyItem;
  const uom = item.scaleData?.fixedWeightString || item.uom;
  return (
    <div
      onClick={() => onClick(item.barcode)}
      className={cn("w-full h-full overflow-hidden p-1", color)}
    >
      <div className="flex-1">
        <div className="w-full h-full line-clamp-2 text-base overflow-hidden font-semibold">
          {lang === "en" ? item.name_en : item.name_ko}
        </div>
      </div>
      <div className="text-sm">{uom}</div>
    </div>
  );
}

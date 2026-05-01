import { useEffect, useMemo, useState } from "react";
import { CloudHotkey, CloudHotkeyItem } from "../types/models";
import { cn } from "../libs/cn";
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";

interface CloudHotkeyViewerV2Props {
  hotkeys: CloudHotkey[];
  onItemClick: (barcode: string) => void;
}

const ITEM_GRID_SIZE = 5;
const GROUP_COLS = 8;
const GROUP_ROWS = 2;
const GROUP_PAGE_SIZE = GROUP_COLS * GROUP_ROWS;
const ITEM_PAGE_SIZE = ITEM_GRID_SIZE * ITEM_GRID_SIZE;

export default function CloudHotkeyViewerV2({
  hotkeys,
  onItemClick,
}: CloudHotkeyViewerV2Props) {
  const [selectedHotkeyId, setSelectedHotkeyId] = useState<number | null>(
    hotkeys[0]?.id ?? null,
  );
  const [groupPage, setGroupPage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const [lang, setLang] = useState<"en" | "ko">("ko");

  const maxGroupPage = Math.max(1, Math.ceil(hotkeys.length / GROUP_PAGE_SIZE));

  useEffect(() => {
    setGroupPage((currentPage) => Math.min(currentPage, maxGroupPage));
  }, [maxGroupPage]);

  useEffect(() => {
    if (hotkeys.length === 0) {
      setSelectedHotkeyId(null);
      setItemPage(1);
      return;
    }

    const stillExists = hotkeys.some(
      (hotkey) => hotkey.id === selectedHotkeyId,
    );
    if (!stillExists) {
      setSelectedHotkeyId(hotkeys[0].id);
      setGroupPage(1);
      setItemPage(1);
    }
  }, [hotkeys, selectedHotkeyId]);

  const selectedHotkey = useMemo(() => {
    return hotkeys.find((hotkey) => hotkey.id === selectedHotkeyId) ?? null;
  }, [hotkeys, selectedHotkeyId]);

  const visibleGroups = useMemo(() => {
    const start = (groupPage - 1) * GROUP_PAGE_SIZE;
    return hotkeys.slice(start, start + GROUP_PAGE_SIZE);
  }, [hotkeys, groupPage]);

  const currentItems = useMemo(() => {
    return selectedHotkey?.keys.filter((key) => key.page === itemPage) ?? [];
  }, [selectedHotkey, itemPage]);

  const maxItemPage = useMemo(() => {
    if (!selectedHotkey || selectedHotkey.keys.length === 0) return 1;
    return Math.max(1, ...selectedHotkey.keys.map((key) => key.page));
  }, [selectedHotkey]);

  const hasPrevGroup = groupPage > 1;
  const hasNextGroup = groupPage < maxGroupPage;
  const hasPrevItem = itemPage > 1;
  const hasNextItem = itemPage < maxItemPage;

  useEffect(() => {
    setItemPage((currentPage) => Math.min(currentPage, maxItemPage));
  }, [maxItemPage]);

  function handleSelectGroup(hotkeyId: number) {
    setSelectedHotkeyId(hotkeyId);
    setItemPage(1);
  }

  if (hotkeys.length === 0) {
    return (
      <div className="w-full h-full center text-sm font-medium text-gray-400">
        No hotkeys configured
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      <div className="h-[184px] shrink-0 bg-zinc-700">
        <div className="h-[132px] grid grid-cols-8 grid-rows-2 gap-2 p-2">
          {Array.from({ length: GROUP_PAGE_SIZE }).map((_, index) => {
            const group = visibleGroups[index];
            if (!group) {
              return (
                <div
                  key={`empty-group-${groupPage}-${index}`}
                  className="rounded-md border border-dashed border-zinc-500 bg-zinc-600"
                />
              );
            }

            return (
              <GroupButton
                key={group.id}
                group={group}
                lang={lang}
                selected={group.id === selectedHotkeyId}
                onClick={() => handleSelectGroup(group.id)}
              />
            );
          })}
        </div>

        <div className="h-[52px] grid grid-cols-5 gap-2 px-2 pb-2">
          <PagerButton
            label="Prev"
            disabled={!hasPrevGroup}
            onClick={() => setGroupPage(groupPage - 1)}
          />
          <StatusButton
            className="col-span-3"
            label={`${lang.toUpperCase()} Groups ${groupPage} / ${maxGroupPage}`}
            onClick={() => setLang(lang === "en" ? "ko" : "en")}
          />
          <PagerButton
            label="Next"
            disabled={!hasNextGroup}
            onClick={() => setGroupPage(groupPage + 1)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 flex flex-col">
        <div className="min-h-0 flex-1 grid grid-cols-5 grid-rows-5 gap-1 p-2">
          {Array.from({ length: ITEM_PAGE_SIZE }).map((_, index) => {
            const xIdx = index % ITEM_GRID_SIZE;
            const yIdx = Math.floor(index / ITEM_GRID_SIZE);
            const keyItem = currentItems.find(
              (item) => item.x === xIdx && item.y === yIdx,
            );

            if (!keyItem) {
              return (
                <div
                  key={`${itemPage}-${xIdx},${yIdx}`}
                  className="rounded-md border border-gray-300 bg-white"
                />
              );
            }

            return (
              <KeyCell
                key={keyItem.id}
                keyItem={keyItem}
                lang={lang}
                onClick={onItemClick}
              />
            );
          })}
        </div>

        <div className="h-[52px] shrink-0 grid grid-cols-5 gap-2 p-2 pt-0">
          <PagerButton
            label="Prev"
            disabled={!hasPrevItem}
            onClick={() => setItemPage(itemPage - 1)}
          />
          <StatusButton
            className="col-span-3"
            label={`${selectedHotkey ? getGroupName(selectedHotkey, lang) : "-"} ${itemPage} / ${maxItemPage}`}
          />
          <PagerButton
            label="Next"
            disabled={!hasNextItem}
            onClick={() => setItemPage(itemPage + 1)}
          />
        </div>
      </div>
    </div>
  );
}

function GroupButton({
  group,
  lang,
  selected,
  onClick,
}: {
  group: CloudHotkey;
  lang: "en" | "ko";
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      onClick={onClick}
      className={cn(
        "w-full h-full rounded-md border px-2 text-center text-sm font-bold leading-tight",
        "flex items-center justify-center overflow-hidden active:opacity-80",
        group.color || "bg-green-600 text-white",
        selected ? "border-blue-900 ring-4 ring-blue-400" : "border-gray-400",
      )}
    >
      <span className="line-clamp-2">{getGroupName(group, lang)}</span>
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
  const priceLabel = getPriceLabel(keyItem);

  return (
    <div
      role="button"
      onClick={() => onClick(item.barcode)}
      className={cn(
        "w-full h-full rounded-md border border-gray-300 p-1 text-left",
        "flex flex-col justify-between overflow-hidden active:opacity-80",
        color || "bg-white text-black",
      )}
    >
      <span className="line-clamp-2 text-sm leading-tight font-semibold overflow-hidden">
        {lang === "en" ? item.name_en : item.name_ko}
      </span>
      <span className="line-clamp-1 text-xs font-medium opacity-80">
        {priceLabel ?? uom}
      </span>
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "h-full rounded-md bg-slate-500 text-base font-bold text-white",
        "flex items-center justify-center active:opacity-80",
        disabled && "opacity-40",
      )}
    >
      {label}
    </div>
  );
}

function StatusButton({
  label,
  className,
  onClick,
}: {
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "h-full rounded-md bg-blue-600 px-2 text-sm font-bold text-white",
        "flex items-center justify-center overflow-hidden text-center leading-tight",
        onClick && "active:opacity-80",
        className,
      )}
    >
      <span className="line-clamp-2">{label}</span>
    </div>
  );
}

function getGroupName(group: CloudHotkey, lang: "en" | "ko") {
  return lang === "en" ? group.name_en : group.name_ko;
}

function getPriceLabel(keyItem: CloudHotkeyItem) {
  const { item } = keyItem;
  const defaultPrice = item.price?.prices[0] ?? null;
  const promoPrice = item.promoPrice?.prices[0] ?? null;
  const price = promoPrice ?? defaultPrice;
  const uom = item.scaleData?.fixedWeightString || item.uom;

  if (price === null) return null;
  return `$${(price / MONEY_SCALE).toFixed(MONEY_DP)}/${uom}`;
}

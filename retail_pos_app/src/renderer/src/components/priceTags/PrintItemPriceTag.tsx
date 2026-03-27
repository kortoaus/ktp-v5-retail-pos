import { useCallback, useMemo, useState } from "react";
import { Item } from "../../types/models";
import { searchItemByBarcode } from "../../service/item.service";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import SearchItemList from "../SearchItemList";
import PagingRowList from "../list/PagingRowList";
import { itemNameParser } from "../../libs/item-utils";
import {
  buildPriceTag7030,
  buildPriceTag7090,
} from "../../libs/label-templates";
import { mergeLabelOutputs } from "../../libs/label-builder";
import { LabelPrinter, useZplPrinters } from "../../hooks/useZplPrinters";

const QUEUE_PAGE_SIZE = 10;

export default function PrintItemPriceTag() {
  const [queue, setQueue] = useState<Item[]>([]);
  const { printLabel, printers } = useZplPrinters();

  const scanCallback = useCallback(
    async (rawBarcode: string) => {
      const { ok, result } = await searchItemByBarcode(rawBarcode);
      if (ok && result) {
        setQueue((prev) => {
          if (prev.some((i) => i.id === result.id)) return prev;
          return [...prev, result];
        });
      }
    },
    [],
  );

  useBarcodeScanner(scanCallback);

  const printers7030 = useMemo(
    () => printers.filter((p) => p.mediaSize === "7030"),
    [printers],
  );
  const printers7090 = useMemo(
    () => printers.filter((p) => p.mediaSize === "7090"),
    [printers],
  );

  const handlePrintLabel7030 = (printer: LabelPrinter) => {
    if (queue.length === 0) return;
    const merged = mergeLabelOutputs(
      queue.map((item) => buildPriceTag7030(printer.language, item)),
    );
    if (merged) printLabel(printer, merged);
  };

  const handlePrintLabel7090 = (printer: LabelPrinter) => {
    if (queue.length === 0) return;
    const merged = mergeLabelOutputs(
      queue.map((item) => buildPriceTag7090(printer.language, item)),
    );
    if (merged) printLabel(printer, merged);
  };

  const handleSelect = (item: Item) => {
    setQueue((prev) => {
      const isExists = prev.some((i) => i.id === item.id);
      if (isExists) {
        return [...prev.filter((i) => i.id !== item.id)];
      }
      return [...prev, item];
    });
  };

  return (
    <div className="h-full w-full bg-white flex divide-x divide-gray-200">
      <div className="w-[300px] h-full">
        <SearchItemList
          selectedItemId={null}
          selectedItemIds={queue.map((i) => i.id)}
          onSelect={handleSelect}
          listSize={QUEUE_PAGE_SIZE}
        />
      </div>
      <div className="w-[300px] h-full flex flex-col">
        <div className="h-12 flex items-center justify-between px-3 bg-gray-100 border-b border-gray-200">
          <span className="text-sm font-semibold">Queue ({queue.length})</span>
          {queue.length > 0 && (
            <button
              onPointerDown={() => setQueue([])}
              className="text-xs font-medium text-red-600 hover:text-red-800"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex-1">
          <PagingRowList
            rows={queue}
            pageSize={QUEUE_PAGE_SIZE}
            Renderer={({ item }) => (
              <QueueItem item={item} onRemove={() => handleSelect(item)} />
            )}
          />
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        {printers7030.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              70×30
            </div>
            <div className="flex flex-wrap gap-2">
              {printers7030.map((p) => (
                <button
                  key={p.name}
                  onPointerDown={() => handlePrintLabel7030(p)}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {printers7090.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              70×90
            </div>
            <div className="flex flex-wrap gap-2">
              {printers7090.map((p) => (
                <button
                  key={p.name}
                  onPointerDown={() => handlePrintLabel7090(p)}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {printers7030.length === 0 && printers7090.length === 0 && (
          <div className="text-sm text-gray-400">
            No label printers configured with media size.
          </div>
        )}
      </div>
    </div>
  );
}

function QueueItem({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const hasPromo = item.promoPrice != null;
  const { name_en, name_ko } = itemNameParser(item);
  return (
    <div className="flex items-center px-3 h-full hover:bg-gray-50 transition-colors overflow-hidden">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {hasPromo && <span className="font-bold text-red-500">{`[P]`}</span>}
          {name_en}
        </div>
        <div className="text-xs text-gray-500 truncate">{name_ko}</div>
      </div>
      <button
        onPointerDown={onRemove}
        className="text-xs text-red-500 hover:text-red-700 font-medium shrink-0 ml-2"
      >
        Remove
      </button>
    </div>
  );
}

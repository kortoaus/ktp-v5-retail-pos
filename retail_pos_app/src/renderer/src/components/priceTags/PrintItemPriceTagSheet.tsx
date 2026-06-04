import { useEffect, useMemo, useState } from "react";
import { QTY_DP, QTY_SCALE } from "../../libs/constants";
import {
  getCloudLabelUpdateSheetById,
  getPrintedLabelUpdateSheetIds,
  markLabelUpdateSheetPrinted,
  migrateDataFromCloudServer,
} from "../../service/cloud.service";
import { getItemsByIds } from "../../service/item.service";
import { CloudItemSheet, CloudItemSheetRow, Item } from "../../types/models";
import { cn } from "../../libs/cn";
import { LabelPrinter, useZplPrinters } from "../../hooks/useZplPrinters";
import { buildPriceTag7030 } from "../../libs/label-templates";
import { buildPriceTag7090V2 } from "../../libs/label-7090-v2";
import { mergeLabelOutputs } from "../../libs/label-builder";
import PagingRowList from "../list/PagingRowList";
import SearchItemSheetList from "./SearchItemSheetList";
import LoadingOverlay from "../LoadingOverlay";
import { useTerminal } from "../../contexts/TerminalContext";
import { useStoreSetting } from "../../hooks/useStoreSetting";

const QUEUE_PAGE_SIZE = 10;
const PRINTED_SHEET_STORAGE_PREFIX = "pos.printedItemSheetIds";
const PRINTED_SHEET_MIGRATION_PREFIX = "pos.printedItemSheetIdsMigrated";

export default function PrintItemPriceTagSheet() {
  const { terminal } = useTerminal();
  const [selectedSheet, setSelectedSheet] = useState<CloudItemSheet | null>(
    null,
  );
  const [queue, setQueue] = useState<CloudItemSheetRow[]>([]);
  const [printedSheetIds, setPrintedSheetIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [selectedPrinter7030, setSelectedPrinter7030] =
    useState<LabelPrinter | null>(null);
  const [selectedPrinter7090, setSelectedPrinter7090] =
    useState<LabelPrinter | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("Printing labels...");
  const { printLabel, printers } = useZplPrinters();
  const { storeSetting } = useStoreSetting();

  const printers7030 = useMemo(
    () => printers.filter((p) => p.mediaSize === "7030"),
    [printers],
  );
  const printers7090 = useMemo(
    () => printers.filter((p) => p.mediaSize === "7090"),
    [printers],
  );
  const printedSheetStorageKey = terminal
    ? `${PRINTED_SHEET_STORAGE_PREFIX}.${terminal.id}`
    : null;
  const printedSheetMigrationKey = terminal
    ? `${PRINTED_SHEET_MIGRATION_PREFIX}.${terminal.id}`
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadPrintedSheetIds() {
      const res = await getPrintedLabelUpdateSheetIds();
      if (cancelled) return;

      if (res.ok && res.result) {
        setPrintedSheetIds(new Set(res.result));
      }
    }

    loadPrintedSheetIds().catch((err) => {
      console.error("Failed to load printed item sheet ids:", err);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!printedSheetStorageKey || !printedSheetMigrationKey) return;
    if (localStorage.getItem(printedSheetMigrationKey) === "1") return;

    const oldIds = [...readPrintedSheetIds(printedSheetStorageKey)];
    if (oldIds.length === 0) {
      localStorage.setItem(printedSheetMigrationKey, "1");
      return;
    }

    let cancelled = false;

    async function migratePrintedSheetIds() {
      const migratedIds: number[] = [];
      for (const sheetId of oldIds) {
        const res = await markLabelUpdateSheetPrinted(sheetId);
        if (!res.ok || !res.result) {
          throw new Error(res.msg || "Failed to migrate printed sheet id");
        }
        migratedIds.push(res.result.sheetId);
      }

      if (cancelled) return;

      setPrintedSheetIds((prev) => {
        const next = new Set(prev);
        for (const sheetId of migratedIds) next.add(sheetId);
        return next;
      });
      localStorage.setItem(printedSheetMigrationKey, "1");
    }

    migratePrintedSheetIds().catch((err) => {
      console.error("Failed to migrate printed item sheet ids:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [printedSheetMigrationKey, printedSheetStorageKey]);

  useEffect(() => {
    setSelectedPrinter7030((prev) => {
      if (prev && printers7030.some((p) => printerKey(p) === printerKey(prev))) {
        return prev;
      }
      return printers7030.length === 1 ? printers7030[0] : null;
    });
  }, [printers7030]);

  useEffect(() => {
    setSelectedPrinter7090((prev) => {
      if (prev && printers7090.some((p) => printerKey(p) === printerKey(prev))) {
        return prev;
      }
      return printers7090.length === 1 ? printers7090[0] : null;
    });
  }, [printers7090]);

  const handleSelectSheet = async (sheet: CloudItemSheet) => {
    const { ok, result, msg } = await getCloudLabelUpdateSheetById(sheet.id);
    if (!ok || !result) {
      window.alert(msg || "Failed to load item sheet");
      return;
    }
    setSelectedSheet(result);
    setQueue(result.rows);
  };

  const handleRemoveRow = (row: CloudItemSheetRow) => {
    setQueue((prev) => prev.filter((r) => r.id !== row.id));
  };

  const handlePrint = async () => {
    if (
      processing ||
      selectedSheet === null ||
      selectedPrinter7030 === null ||
      queue.length === 0
    ) {
      return;
    }

    const p7030: Item[] = [];
    const p7090: Item[] = [];

    setProcessingLabel("Syncing item data...");
    setProcessing(true);
    try {
      const syncResult = await migrateDataFromCloudServer();
      if (!syncResult.ok) {
        window.alert(syncResult.msg || "Failed to sync item data");
        return;
      }

      setProcessingLabel("Preparing labels...");
      const itemIds = [...new Set(queue.map((qu) => qu.itemId))];
      const itemResult = await getItemsByIds(itemIds);
      if (!itemResult.ok || !itemResult.result) {
        window.alert(itemResult.msg || "Failed to load items");
        return;
      }

      for (const item of itemResult.result) {
        if (shouldPrint7090(item, selectedPrinter7090 !== null)) {
          p7090.push(item);
        } else {
          p7030.push(item);
        }
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to print labels",
      );
      return;
    } finally {
      setProcessing(false);
    }

    const totalPrintCount = p7030.length + p7090.length;
    if (totalPrintCount === 0) return;

    const confirmed = window.confirm(
      `Print ${totalPrintCount} labels now?\n\nOnce this job is sent to the printer, it cannot be cancelled.`,
    );
    if (!confirmed) return;

    const finalConfirmed = window.confirm(
      "Final confirmation: this print job cannot be cancelled after it starts. Continue?",
    );
    if (!finalConfirmed) return;

    setProcessingLabel("Printing labels...");
    setProcessing(true);
    try {
      if (p7030.length > 0) {
        const merged = mergeLabelOutputs(
          p7030.map((item) =>
            buildPriceTag7030(selectedPrinter7030.language, item),
          ),
        );
        if (merged) {
          const result = await printLabel(selectedPrinter7030, merged);
          if (!result.ok) {
            window.alert(result.message || "Failed to print 70x30 labels");
            return;
          }
        }
      }

      if (selectedPrinter7090 !== null && p7090.length > 0) {
        const labels = await Promise.all(
          p7090.map((item) =>
            buildPriceTag7090V2(selectedPrinter7090.language, item, {
              storeName: storeSetting?.name,
            }),
          ),
        );
        const merged = mergeLabelOutputs(labels);
        if (merged) {
          const result = await printLabel(selectedPrinter7090, merged);
          if (!result.ok) {
            window.alert(result.message || "Failed to print 70x90 labels");
            return;
          }
        }
      }

      await markSheetPrinted(selectedSheet.id);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to print labels",
      );
    } finally {
      setProcessing(false);
    }
  };

  const markSheetPrinted = async (sheetId: number) => {
    try {
      const res = await markLabelUpdateSheetPrinted(sheetId);
      if (!res.ok || !res.result) {
        window.alert(
          res.msg ||
            "Labels were printed, but the Printed marker could not be saved.",
        );
        return;
      }

      setPrintedSheetIds((prev) => {
        const next = new Set(prev);
        next.add(res.result.sheetId);
        return next;
      });
    } catch (err) {
      console.error("Failed to mark printed item sheet:", err);
      window.alert(
        "Labels were printed, but the Printed marker could not be saved.",
      );
    }
  };

  return (
    <div className="h-full w-full bg-white flex divide-x divide-gray-200">
      {processing && <LoadingOverlay label={processingLabel} />}
      <div className="w-[300px] h-full">
        <SearchItemSheetList
          selectedSheetId={selectedSheet?.id ?? null}
          selectedSheetIds={null}
          printedSheetIds={printedSheetIds}
          onSelect={handleSelectSheet}
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
              <QueueRow row={item} onRemove={() => handleRemoveRow(item)} />
            )}
          />
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <SheetQueueStatus selectedSheet={selectedSheet} queueLength={queue.length} />
        <PrinterSelectGroup
          title="70×30"
          printers={printers7030}
          selectedPrinter={selectedPrinter7030}
          onSelect={setSelectedPrinter7030}
        />
        <PrinterSelectGroup
          title="70×90"
          printers={printers7090}
          selectedPrinter={selectedPrinter7090}
          onSelect={setSelectedPrinter7090}
          nullable
        />
        {printers7030.length === 0 && printers7090.length === 0 && (
          <div className="text-sm text-gray-400">
            No label printers configured with media size.
          </div>
        )}
        <button
          disabled={
            processing ||
            selectedSheet === null ||
            selectedPrinter7030 === null ||
            queue.length === 0
          }
          onPointerDown={handlePrint}
          className={cn(
            "rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors",
            processing ||
              selectedSheet === null ||
              selectedPrinter7030 === null ||
              queue.length === 0
              ? "bg-gray-300"
              : "bg-blue-600 hover:bg-blue-700",
          )}
        >
          Print
        </button>
      </div>
    </div>
  );
}

function SheetQueueStatus({
  selectedSheet,
  queueLength,
}: {
  selectedSheet: CloudItemSheet | null;
  queueLength: number;
}) {
  if (!selectedSheet) {
    return <div className="text-sm font-medium text-gray-700">No sheet selected</div>;
  }

  return (
    <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="text-sm font-semibold text-gray-800">
        Sheet #{selectedSheet.id}
      </div>
      <div className="text-xs text-gray-500">
        {selectedSheet.author} · {selectedSheet.rows.length} rows
      </div>
      <div className="text-xs font-medium text-gray-600">
        Queue {queueLength} / {selectedSheet.rows.length}
      </div>
      {selectedSheet.note && (
        <div className="text-xs text-gray-400 truncate">{selectedSheet.note}</div>
      )}
    </div>
  );
}

function PrinterSelectGroup({
  title,
  printers,
  selectedPrinter,
  onSelect,
  nullable = false,
}: {
  title: string;
  printers: LabelPrinter[];
  selectedPrinter: LabelPrinter | null;
  onSelect: (printer: LabelPrinter | null) => void;
  nullable?: boolean;
}) {
  if (printers.length === 0 && !nullable) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {nullable && (
          <button
            onPointerDown={() => onSelect(null)}
            className={cn(
              "rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              selectedPrinter == null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200",
            )}
          >
            None
          </button>
        )}
        {printers.map((printer) => {
          const selected =
            selectedPrinter != null &&
            printerKey(selectedPrinter) === printerKey(printer);
          return (
            <button
              key={printerKey(printer)}
              onPointerDown={() => onSelect(printer)}
              className={cn(
                "rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                selected
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
            >
              {printer.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QueueRow({
  row,
  onRemove,
}: {
  row: CloudItemSheetRow;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center px-3 h-full hover:bg-gray-50 transition-colors overflow-hidden">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{row.name_en}</div>
        <div className="text-xs text-gray-500 truncate">
          {row.barcode}
          {row.name_ko ? ` · ${row.name_ko}` : ""}
        </div>
        <div className="text-xs text-gray-400 truncate">
          Qty {formatQty(row.qty)}
          {row.note ? ` · ${row.note}` : ""}
        </div>
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

function formatQty(qty: number): string {
  return (qty / QTY_SCALE)
    .toFixed(QTY_DP)
    .replace(/\.?0+$/, "");
}

function shouldPrint7090(item: Item, has7090Printer: boolean): boolean {
  if (!has7090Printer) return false;
  if (item.promoPrice !== null) return true;

  const guestPrice = item.price?.prices[0];
  const memberPrice = item.price?.prices[1];

  return (
    typeof guestPrice === "number" &&
    typeof memberPrice === "number" &&
    memberPrice > 0 &&
    memberPrice < guestPrice
  );
}

function readPrintedSheetIds(storageKey: string): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    );
  } catch {
    return new Set();
  }
}

function printerKey(printer: LabelPrinter): string {
  if (printer.type === "serial") {
    return `${printer.type}:${printer.path}:${printer.mediaSize ?? ""}`;
  }
  return `${printer.type}:${printer.host}:${printer.port}:${printer.mediaSize ?? ""}`;
}

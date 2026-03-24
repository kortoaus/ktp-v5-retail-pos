import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Item } from "../types/models";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useWeight } from "../hooks/useWeight";
import { useZplPrinters } from "../hooks/useZplPrinters";
import { searchItemByBarcode } from "../service/item.service";
import { getItemType, itemNameParser } from "../libs/item-utils";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../libs/constants";
import { buildPPLabel60x30 } from "../libs/label-templates";
import { buildPPBarcodeString } from "../libs/pp-barcode";
import SearchItemModal from "../components/SearchItemModal";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
const fmtWeight = (w: number) => (w / QTY_SCALE).toFixed(QTY_DP);

type ModalTarget = null | "item-search";
type DiscountType = "pct" | "amt" | null;

export default function WeightLabelScreen() {
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState("");
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);

  const [weightInt, setWeightInt] = useState<number | null>(null);
  const [scaleReading, setScaleReading] = useState<{
    weight: number;
    unit: string;
    status: string;
    message?: string;
  } | null>(null);
  const [readingScale, setReadingScale] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef(false);

  const [discountType, setDiscountType] = useState<DiscountType>(null);
  const [discountValue, setDiscountValue] = useState("");

  const { connected: scaleConnected, readWeight } = useWeight();
  const { printers, printLabel } = useZplPrinters();

  function processItem(newItem: Item) {
    const type = getItemType(newItem);
    if (type === "invalid") {
      window.alert("Invalid item");
      return;
    }
    if (!newItem.price) {
      window.alert("Item has no price");
      return;
    }
    setItem(newItem);
    setWeightInt(null);
    setDiscountType(null);
    setDiscountValue("");
    setModalTarget(null);
  }

  const scanCallback = useCallback(
    async (barcode: string) => {
      if (loading) return;
      setLoading(true);
      setLastScanned(barcode);
      try {
        const { ok, result } = await searchItemByBarcode(barcode);
        if (ok && result) {
          processItem(result);
        } else {
          window.alert("Item not found");
        }
      } catch {
        window.alert("Failed to scan");
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  useBarcodeScanner(scanCallback);

  const itemType = useMemo(() => (item ? getItemType(item) : null), [item]);
  const isWeight = itemType === "weight";

  const handleReadScale = useCallback(async () => {
    setReadingScale(true);
    try {
      const result = await readWeight();
      setScaleReading(result);
      if (result.status === "stable" && isWeight) {
        setWeightInt(Math.round(result.weight * QTY_SCALE));
      }
    } catch {
      setScaleReading({
        weight: 0,
        unit: "kg",
        status: "error",
        message: "Read failed",
      });
    } finally {
      setReadingScale(false);
    }
  }, [readWeight, isWeight]);

  useEffect(() => {
    pollingRef.current = polling;
    if (!polling) return;
    let cancelled = false;
    const poll = async () => {
      while (pollingRef.current && !cancelled) {
        try {
          const result = await readWeight();
          if (cancelled) break;
          setScaleReading(result);
          if (result.status === "stable" && isWeight) {
            setWeightInt(Math.round(result.weight * QTY_SCALE));
          }
        } catch {
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [polling, readWeight, isWeight]);

  const labelData = useMemo(() => {
    if (!item || !item.price) return null;

    const { name_en, name_ko } = itemNameParser(item);
    const prices = item.price.prices;
    const promoPrices = item.promoPrice?.prices ?? [];
    const unitPriceCents = prices[0] ?? 0;

    let totalPriceCents: number;
    let ppWeight: number | null = null;

    if (isWeight) {
      if (!weightInt) return null;
      ppWeight = weightInt;
      totalPriceCents = Math.round((unitPriceCents * weightInt) / QTY_SCALE);
    } else {
      totalPriceCents = unitPriceCents;
    }

    let discountAmount = 0;
    let dt: DiscountType = null;
    const dv = parseFloat(discountValue || "0");
    if (discountType === "pct" && dv > 0 && dv <= 100) {
      discountAmount = Math.round(dv * 10);
      dt = "pct";
    } else if (discountType === "amt" && dv > 0) {
      discountAmount = Math.round(dv * MONEY_SCALE);
      dt = "amt";
    }

    let finalPriceCents = totalPriceCents;
    if (dt === "pct") {
      finalPriceCents = Math.round(
        (totalPriceCents * (1000 - discountAmount)) / 1000,
      );
    } else if (dt === "amt") {
      finalPriceCents = totalPriceCents - discountAmount;
    }
    if (finalPriceCents < 0) finalPriceCents = 0;

    const ppBarcode = buildPPBarcodeString({
      barcode: item.barcodeGTIN || item.barcodePLU || item.barcode,
      prices,
      promoPrices,
      weight: ppWeight,
      discountType: dt,
      discountAmount,
    });

    return {
      name_en,
      name_ko,
      unitPrice: fmtMoney(unitPriceCents),
      totalPrice: fmtMoney(finalPriceCents),
      weight: ppWeight != null ? fmtWeight(ppWeight) : null,
      ppBarcode,
      finalPriceCents,
      hasDiscount: dt !== null,
      originalTotalPrice: fmtMoney(totalPriceCents),
    };
  }, [item, weightInt, discountType, discountValue, isWeight]);

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>
        <button
          type="button"
          onPointerDown={() => setModalTarget("item-search")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          Search Item
        </button>
        {loading && <span className="text-sm text-gray-400">Loading...</span>}
        {lastScanned && (
          <span className="text-sm text-gray-400">
            Last scan: {lastScanned}
          </span>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {!item && (
            <div className="text-gray-400 text-lg">
              Scan an item to print PP label
            </div>
          )}

          {item && (
            <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md">
              <div className="text-lg font-bold truncate">
                {itemNameParser(item).name_en}
              </div>
              <div className="text-base text-gray-500 truncate">
                {itemNameParser(item).name_ko}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Type: {itemType} | Unit: $
                {fmtMoney(item.price?.prices[0] ?? 0)}
                {isWeight && "/kg"}
              </div>

              {isWeight && weightInt == null && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                  Read scale to apply weight
                </div>
              )}

              {labelData && (
                <>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold">
                      ${labelData.totalPrice}
                    </span>
                    {labelData.hasDiscount && (
                      <span className="text-lg text-red-500 line-through">
                        ${labelData.originalTotalPrice}
                      </span>
                    )}
                  </div>
                  {labelData.weight && (
                    <div className="text-sm text-gray-500">
                      {labelData.weight}kg x ${labelData.unitPrice}/kg
                    </div>
                  )}

                  <div className="mt-2 text-xs text-gray-400 font-mono break-all">
                    {labelData.ppBarcode}
                  </div>
                </>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onPointerDown={() => {
                    setDiscountType(discountType === "pct" ? null : "pct");
                    setDiscountValue("");
                  }}
                  className={`flex-1 h-10 rounded-lg text-sm font-bold ${discountType === "pct" ? "bg-red-500 text-white" : "bg-gray-100"}`}
                >
                  Markdown %
                </button>
                <button
                  type="button"
                  onPointerDown={() => {
                    setDiscountType(discountType === "amt" ? null : "amt");
                    setDiscountValue("");
                  }}
                  className={`flex-1 h-10 rounded-lg text-sm font-bold ${discountType === "amt" ? "bg-red-500 text-white" : "bg-gray-100"}`}
                >
                  Markdown $
                </button>
              </div>

              {discountType && (
                <div className="mt-2">
                  <input
                    type="number"
                    step={discountType === "pct" ? "1" : "0.01"}
                    min="0"
                    max={discountType === "pct" ? "100" : undefined}
                    placeholder={
                      discountType === "pct" ? "Percent off" : "Amount off"
                    }
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 text-lg font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2">
                {printers.map((printer) => (
                  <button
                    key={printer.name}
                    type="button"
                    disabled={!labelData}
                    onPointerDown={() => {
                      if (!labelData) return;
                      const label = buildPPLabel60x30(printer.language, {
                        name_ko: labelData.name_ko,
                        name_en: labelData.name_en,
                        unitPrice: labelData.unitPrice,
                        totalPrice: labelData.totalPrice,
                        weight: labelData.weight,
                        ppBarcode: labelData.ppBarcode,
                      });
                      printLabel(printer, label);
                    }}
                    className="w-full py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
                  >
                    Print on {printer.name}
                  </button>
                ))}
                {printers.length === 0 && (
                  <div className="text-sm text-gray-400 text-center">
                    No printers configured
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-72 border-l border-gray-200 bg-white flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
            <h2 className="text-base font-bold">Scale</h2>
            <span
              className={`w-2 h-2 rounded-full ${scaleConnected ? "bg-green-500" : "bg-gray-300"}`}
            />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
            <div className="bg-gray-50 rounded-xl p-6 w-full text-center">
              <div className="text-4xl font-bold tabular-nums">
                {scaleReading
                  ? scaleReading.weight.toFixed(QTY_DP)
                  : "\u2014.\u2014\u2014\u2014"}
              </div>
              <div className="text-base text-gray-500 mt-1">
                {scaleReading?.unit ?? "kg"}
              </div>
              {scaleReading && (
                <div
                  className={`text-sm mt-2 font-medium ${scaleReading.status === "stable" ? "text-green-600" : "text-amber-600"}`}
                >
                  {scaleReading.status === "stable" && "Stable"}
                  {scaleReading.status === "unstable" && "Unstable"}
                  {scaleReading.status === "error" &&
                    (scaleReading.message ?? "Error")}
                  {scaleReading.status === "disconnected" && "Disconnected"}
                </div>
              )}
            </div>

            <button
              type="button"
              onPointerDown={handleReadScale}
              disabled={readingScale}
              className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 disabled:opacity-50 font-medium text-base"
            >
              {readingScale
                ? "Reading..."
                : scaleReading
                  ? "Re-read"
                  : "Read Scale"}
            </button>

            <button
              type="button"
              onPointerDown={() => setPolling((p) => !p)}
              className={`w-full py-3 rounded-xl font-medium text-base ${polling ? "bg-red-100 text-red-700 active:bg-red-200" : "bg-gray-100 active:bg-gray-200"}`}
            >
              {polling ? "Stop Auto" : "Auto Read"}
            </button>
          </div>
        </div>
      </div>

      <SearchItemModal
        open={modalTarget === "item-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(selectedItem) => processItem(selectedItem)}
      />
    </div>
  );
}

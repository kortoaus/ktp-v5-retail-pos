import { Link } from "react-router-dom";
import { useZplPrinters } from "../hooks/useZplPrinters";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Item } from "../types/models";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useWeight } from "../hooks/useWeight";
import { searchItemByBarcode } from "../service/item.service";
import { getItemType, itemNameParser } from "../libs/item-utils";
import { buildPriceTag60x30 } from "../libs/label-templates";
import { ean13CheckDigit, fiveDigitFloat } from "../libs/barcode-utils";
import { embededPriceParser } from "../libs/scan-utils";
import { BarcodeFormat } from "../libs/label-builder";
import { MONEY_DP, QTY_DP } from "../libs/constants";
import SearchItemModal from "../components/SearchItemModal";

type ModalTarget = null | "item-search";

export default function LabelingScreen() {
  const [item, setItem] = useState<Item | null>(null);
  const [rawBarcode, setRawBarcode] = useState("");
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState("");
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const [scaleReading, setScaleReading] = useState<{
    weight: number;
    unit: string;
    status: string;
    message?: string;
  } | null>(null);
  const [readingScale, setReadingScale] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef(false);

  const { printers, printLabel } = useZplPrinters();
  const { connected: scaleConnected, readWeight } = useWeight();

  // ── Item gateway ──────────────────────────────────────────────

  function processItem(newItem: Item, barcode: string) {
    const type = getItemType(newItem);

    if (type === "invalid" || !newItem.price) {
      window.alert("Invalid item");
      return;
    }

    setItem(newItem);
    setRawBarcode(barcode);
    setWeightKg(null);
    setModalTarget(null);
  }

  // ── Barcode scan ──────────────────────────────────────────────

  const scanCallback = useCallback(
    async (barcode: string) => {
      if (loading) return;
      setLoading(true);
      setLastScanned(barcode);
      try {
        const { ok, result } = await searchItemByBarcode(barcode);
        if (ok && result) {
          processItem(result, barcode);
        } else {
          setItem(null);
          window.alert("Item not found");
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  useBarcodeScanner(scanCallback);

  // ── Scale ─────────────────────────────────────────────────────

  const needsWeight = useMemo(() => {
    if (!item) return false;
    const type = getItemType(item);
    return type === "weight" && !isEAN13WithEmbeddedPrice(rawBarcode);
  }, [item, rawBarcode]);

  const handleReadScale = useCallback(async () => {
    setReadingScale(true);
    try {
      const result = await readWeight();
      setScaleReading(result);
      if (result.status === "stable" && needsWeight) {
        setWeightKg(result.weight);
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
  }, [readWeight, needsWeight]);

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
          if (result.status === "stable" && needsWeight) {
            setWeightKg(result.weight);
          }
        } catch {
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [polling, readWeight, needsWeight]);

  // ── Computed label data ───────────────────────────────────────

  const itemType = useMemo(() => {
    if (!item) return null;
    return getItemType(item);
  }, [item]);

  const labelData = useMemo(() => {
    if (!item || !item.price) return null;

    const { name_en, name_ko } = itemNameParser(item);
    const type = getItemType(item);
    const unitPrice = item.price.prices[0] || 0;
    const plu = item.barcodePLU || item.barcode;

    let price: number;
    let barcode: string;
    let barcodeFormat: BarcodeFormat = "RAW";

    const isWP = type === "weight" && isEAN13WithEmbeddedPrice(rawBarcode);

    if (isWP) {
      const raw13 = rawBarcode.length === 12 ? "0" + rawBarcode : rawBarcode;
      price = embededPriceParser(raw13);
      barcode = raw13;
      barcodeFormat = "EAN13";
    } else if (type === "weight") {
      if (!weightKg) {
        price = 0;
        barcode = plu;
      } else {
        price = Math.round(weightKg * unitPrice * 100) / 100;
        const barcode12 = `${plu}${fiveDigitFloat(price)}`;
        barcode = `${barcode12}${ean13CheckDigit(barcode12)}`;
        barcodeFormat = "EAN13";
      }
    } else if (type === "prepacked") {
      price = unitPrice;
      const barcode12 = `${plu}${fiveDigitFloat(price)}`;
      barcode = `${barcode12}${ean13CheckDigit(barcode12)}`;
      barcodeFormat = "EAN13";
    } else {
      price = unitPrice;
      if (item.barcodeGTIN) {
        barcode = item.barcodeGTIN;
        barcodeFormat = "GTIN";
      } else {
        barcode = item.barcode;
      }
    }

    return {
      name_en,
      name_ko,
      price,
      barcode,
      barcodeFormat,
      unitPrice,
      weightKg: type === "weight" && !isWP ? weightKg : null,
    };
  }, [item, rawBarcode, weightKg]);

  // ── Render ────────────────────────────────────────────────────

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
              Scan an item or search to print labels
            </div>
          )}

          {item && labelData && (
            <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md">
              <div className="text-lg font-bold truncate">
                {labelData.name_en}
              </div>
              <div className="text-base text-gray-500 truncate">
                {labelData.name_ko}
              </div>

              {needsWeight && weightKg == null && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                  Read scale to apply weight
                </div>
              )}

              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold">
                  ${labelData.price.toFixed(MONEY_DP)}
                </span>
                {labelData.weightKg != null && (
                  <span className="text-sm text-gray-400">
                    ({labelData.weightKg.toFixed(3)} kg &times; $
                    {labelData.unitPrice.toFixed(MONEY_DP)}/kg)
                  </span>
                )}
              </div>

              <div className="mt-2 text-xs text-gray-400 font-mono">
                {labelData.barcode} ({labelData.barcodeFormat})
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Type: {itemType}
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {printers.map((printer) => (
                  <button
                    key={printer.name}
                    type="button"
                    onPointerDown={() => {
                      const label = buildPriceTag60x30(printer.language, {
                        name_ko: labelData.name_ko,
                        name_en: labelData.name_en,
                        price: labelData.price.toFixed(MONEY_DP),
                        barcode: labelData.barcode,
                        barcodeFormat: labelData.barcodeFormat,
                      });
                      printLabel(printer, label);
                    }}
                    className="w-full py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium text-base"
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
        onSelect={(selectedItem) => {
          const { barcode, barcodeGTIN, barcodePLU } = selectedItem;
          processItem(selectedItem, barcodeGTIN || barcodePLU || barcode);
        }}
      />
    </div>
  );
}

function isEAN13WithEmbeddedPrice(barcode: string): boolean {
  const len = barcode.length;
  if (len !== 12 && len !== 13) return false;
  return barcode.startsWith("2") || barcode.startsWith("02");
}

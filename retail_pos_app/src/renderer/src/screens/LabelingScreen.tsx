import { Link } from "react-router-dom";
import { useZplPrinters } from "../hooks/useZplPrinters";
import { useCallback, useMemo, useState } from "react";
import { Item } from "../types/models";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useWeight } from "../hooks/useWeight";
import { searchItemByBarcode } from "../service/item.service";
import { getItemType, itemNameParser } from "../libs/item-utils";
import { buildPriceTag60x30 } from "../libs/label-templates";
import { ean13CheckDigit, fiveDigitFloat } from "../libs/barcode-utils";
import { embededPriceParser } from "../libs/scan-utils";
import { BarcodeFormat } from "../libs/label-builder";
import { MONEY_DP } from "../libs/constants";
import SearchItemModal from "../components/SearchItemModal";
import WeightModal from "../components/WeightModal";

type ModalTarget = null | "item-search" | "weight";

export default function LabelingScreen() {
  const [item, setItem] = useState<Item | null>(null);
  const [rawBarcode, setRawBarcode] = useState("");
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState("");
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);

  const { printers, printLabel } = useZplPrinters();
  const { readWeight } = useWeight();

  // ── Item gateway ──────────────────────────────────────────────

  function processItem(newItem: Item, barcode: string) {
    const type = getItemType(newItem);

    if (type === "invalid" || !newItem.price) {
      window.alert("Invalid item");
      return;
    }

    const isWeightPrepacked =
      type === "weight" && isEAN13WithEmbeddedPrice(barcode);

    setItem(newItem);
    setRawBarcode(barcode);
    setWeightKg(null);

    if (type === "weight" && !isWeightPrepacked) {
      setModalTarget("weight");
      return;
    }

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

  // ── Weight modal handlers ─────────────────────────────────────

  const handleWeightConfirm = useCallback((kg: number) => {
    setWeightKg(kg);
    setModalTarget(null);
  }, []);

  const handleWeightClose = useCallback(() => {
    setModalTarget(null);
  }, []);

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
      // weight-prepacked: price already embedded in scanned barcode
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
      // prepacked: original price embedded in EAN13
      price = unitPrice;
      const barcode12 = `${plu}${fiveDigitFloat(price)}`;
      barcode = `${barcode12}${ean13CheckDigit(barcode12)}`;
      barcodeFormat = "EAN13";
    } else {
      // normal
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
      {/* Header */}
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

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {/* Empty state */}
        {!item && (
          <div className="text-gray-400 text-lg">
            Scan an item or search to print labels
          </div>
        )}

        {/* Weight item waiting for scale */}
        {item && !labelData && itemType === "weight" && (
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md text-center">
            <div className="text-lg font-bold truncate">
              {itemNameParser(item).name_en}
            </div>
            <div className="text-base text-gray-500 truncate">
              {itemNameParser(item).name_ko}
            </div>
            <div className="text-sm text-gray-400 mt-2">
              ${(item.price?.prices[0] ?? 0).toFixed(MONEY_DP)} / kg
            </div>
            <div className="text-gray-500 mt-4">
              Waiting for weight reading...
            </div>
            <button
              type="button"
              onPointerDown={() => setModalTarget("weight")}
              className="mt-4 px-6 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium"
            >
              Read Scale
            </button>
          </div>
        )}

        {/* Item ready to print */}
        {item && labelData && (
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md">
            <div className="text-lg font-bold truncate">
              {labelData.name_en}
            </div>
            <div className="text-base text-gray-500 truncate">
              {labelData.name_ko}
            </div>

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
            <div className="mt-1 text-xs text-gray-400">Type: {itemType}</div>

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

      {/* Modals */}
      <SearchItemModal
        open={modalTarget === "item-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(selectedItem) => {
          const { barcode, barcodeGTIN, barcodePLU } = selectedItem;
          processItem(selectedItem, barcodeGTIN || barcodePLU || barcode);
        }}
      />

      <WeightModal
        open={modalTarget === "weight"}
        itemName={item ? itemNameParser(item).name_en : ""}
        readWeight={readWeight}
        onConfirm={handleWeightConfirm}
        onClose={handleWeightClose}
        allowZero
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function isEAN13WithEmbeddedPrice(barcode: string): boolean {
  const len = barcode.length;
  if (len !== 12 && len !== 13) return false;
  return barcode.startsWith("2") || barcode.startsWith("02");
}

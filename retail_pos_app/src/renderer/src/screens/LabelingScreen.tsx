import { Link } from "react-router-dom";
import { useZplPrinters } from "../hooks/useZplPrinters";
import { useMemo, useState } from "react";
import { Item } from "../types/models";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { searchItemByBarcode } from "../service/item.service";
import { itemNameParser } from "../libs/item-utils";
import { buildPriceTag60x30 } from "../libs/label-templates";

export default function LabelingScreen() {
  const [item, setItem] = useState<Item | null>(null);
  const { printers, printLabel } = useZplPrinters();
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState("");

  async function scanCallback(barcode: string) {
    if (loading) return;

    setLoading(true);
    setLastScanned(barcode);
    try {
      const { ok, result } = await searchItemByBarcode(barcode);
      if (ok && result) {
        setItem(result);
      } else {
        setItem(null);
        window.alert("Item not found");
      }
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }

  useBarcodeScanner(scanCallback);

  const itemData = useMemo(() => {
    if (!item) return null;
    const { name_en, name_ko } = itemNameParser(item);
    const price = item.price?.prices[0] || 0;
    const barcode = item.barcodeGTIN || item.barcode;
    const barcodeFormat = item.barcodeGTIN ? "GTIN" : "RAW";

    return { name_en, name_ko, price, barcode, barcodeFormat };
  }, [item]);

  return (
    <div className="flex flex-col gap-4 p-6">
      {printers.map((printer) => (
        <button
          onClick={() => {
            if (!itemData) return;
            const label = buildPriceTag60x30(printer.language, {
              name_ko: itemData.name_ko,
              name_en: itemData.name_en,
              price: `${itemData.price.toFixed(2)}`,
              barcode: itemData.barcode,
              barcodeFormat: itemData.barcodeFormat as "GTIN" | "RAW",
            });
            printLabel(printer, label);
          }}
          key={printer.name}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Print on {printer.name}
        </button>
      ))}

      <div className="text-sm text-gray-500">Last Scanned: {lastScanned}</div>
      <div className="text-sm text-gray-700">
        {itemData
          ? `${itemData.name_en} — $${itemData.price.toFixed(2)}`
          : "Scan an item to print"}
      </div>
      <Link
        to="/"
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        &larr; Back
      </Link>
    </div>
  );
}

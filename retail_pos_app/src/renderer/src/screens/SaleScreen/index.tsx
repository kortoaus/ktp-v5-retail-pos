import { useCallback, useMemo, useRef, useState } from "react";
import { useSalesStore } from "../../store/salesStore";
import { useWeight } from "../../hooks/useWeight";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { searchItemByBarcode } from "../../service/item.service";
import { Item } from "../../types/models";
import { generateSaleLineItem } from "../../libs/item-utils";
import { embededPriceParser } from "../../libs/scan-utils";
import { SaleLineItem } from "../../types/sales";
import SearchItemModal from "../../components/SearchItemModal";
import WeightModal from "../../components/WeightModal";
import SyncButton from "../../components/SyncButton";

type ModalTarget = null | "item-search" | "weight";

export default function SaleScreen() {
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const { readWeight } = useWeight();
  const { addLine, carts, activeCartIndex, setMemberLevel } = useSalesStore();
  const scanCallback = useCallback(
    async (rawBarcode: string) => {
      if (loading) return;

      setLoading(true);
      try {
        const { ok, msg, result } = await searchItemByBarcode(rawBarcode);
        if (ok) {
          if (result) {
            addLineGateway(result, rawBarcode);
          }
        } else {
          window.alert(msg);
        }
      } catch (e) {
        console.error(e);
        window.alert("Failed to scan barcode");
      } finally {
        setLoading(false);
        setLastScanned(rawBarcode);
      }
    },
    [loading, addLineGateway],
  );

  useBarcodeScanner(scanCallback);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const pendingWeightLineRef = useRef<SaleLineItem | null>(null);

  function addLineGateway(item: Item, rawBarcode: string) {
    const data = generateSaleLineItem(item, rawBarcode);
    const type = data.type;
    let prepackedPrice: number | undefined = undefined;

    if (type === "invalid") {
      window.alert("Invalid item");
      setModalTarget(null);
      return;
    }

    if (type === "weight") {
      pendingWeightLineRef.current = data;
      setModalTarget("weight");
      return;
    }

    if (type === "weight-prepacked") {
      prepackedPrice = embededPriceParser(
        rawBarcode.length === 12 ? "0" + rawBarcode : rawBarcode,
      );
    }

    if (type === "prepacked") {
      prepackedPrice = embededPriceParser(
        rawBarcode.length === 12 ? "0" + rawBarcode : rawBarcode,
      );

      if (isNaN(prepackedPrice) && rawBarcode.length === 7) {
        const prePrice = data.price?.prices[0] ?? 0;
        if (prePrice === 0) {
          window.alert("Invalid item");
          return;
        }
        prepackedPrice = prePrice;
      }
    }

    addLine(data, prepackedPrice != null ? { prepackedPrice } : undefined);
    setModalTarget(null);
  }

  const handleWeightConfirm = useCallback(
    (weightKg: number) => {
      const data = pendingWeightLineRef.current;
      if (!data) return;
      addLine(data, { qty: weightKg, measured_weight: weightKg });
      pendingWeightLineRef.current = null;
      setModalTarget(null);
    },
    [addLine],
  );

  const handleWeightClose = useCallback(() => {
    pendingWeightLineRef.current = null;
    setModalTarget(null);
  }, []);

  const lines = useMemo(() => {
    const cart = carts[activeCartIndex];
    if (!cart) return [];
    return cart.lines;
  }, [carts, activeCartIndex]);

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200">
        <button onClick={() => setModalTarget("item-search")}>
          search item
        </button>
        <button onClick={() => setMemberLevel(0)}>level 0</button>
        <button onClick={() => setMemberLevel(1)}>level 1</button>
        <button onClick={() => setMemberLevel(2)}>level 2</button>
      </div>

      <div className="flex-1 h-full">
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div key={line.lineKey}>
              <div>{line.type}</div>
              <div>{line.name_en}</div>
              <table>
                <thead>
                  <tr>
                    <th>ORiginal</th>
                    <th>Discounted</th>
                    <th>Adjusted</th>
                    <th>Effective</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{line.unit_price_original}</td>
                    <td>{line.unit_price_discounted}</td>
                    <td>{line.unit_price_adjusted}</td>
                    <td>{line.unit_price_effective}</td>
                  </tr>
                </tbody>
              </table>
              <div>{JSON.stringify(line.price?.prices)}</div>
              <div>{JSON.stringify(line.promoPrice?.prices)}</div>
              <div>{line.qty}</div>
              <div>{line.measured_weight}</div>
              <div>{line.total}</div>
            </div>
          ))}
        </div>
      </div>

      <SearchItemModal
        open={modalTarget === "item-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(item) => {
          const { barcode, barcodeGTIN, barcodePLU } = item;
          addLineGateway(item, barcodeGTIN || barcodePLU || barcode);
        }}
      />

      <WeightModal
        open={modalTarget === "weight"}
        itemName={pendingWeightLineRef.current?.name_en ?? ""}
        readWeight={readWeight}
        onConfirm={handleWeightConfirm}
        onClose={handleWeightClose}
      />

      <SyncButton />
    </div>
  );
}

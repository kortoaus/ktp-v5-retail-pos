import { useCallback, useMemo, useRef, useState } from "react";
import { LINE_PAGE_SIZE, useSalesStore } from "../../store/salesStore";
import { useWeight } from "../../hooks/useWeight";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { searchItemByBarcode } from "../../service/item.service";
import { Item } from "../../types/models";
import { generateSaleLineItem } from "../../libs/item-utils";
import { embededPriceParser } from "../../libs/scan-utils";
import { SaleLineItem } from "../../types/sales";
import SearchItemModal from "../../components/SearchItemModal";
import WeightModal from "../../components/WeightModal";
import SaleScreenLineViewer from "./SaleScreenLineViewer";
import LineFunctionPanel from "./LineFunctionPanel";
import ChangeQtyModal from "./ChangeQtyModal";
import InjectPriceModal from "./InjectPriceModal";
import DiscountAmountModal from "./DiscountAmountModal";
import DiscountPercentModal from "./DiscountPercentModal";
import Paging from "./Paging";
import Hotkeys from "../../components/Hotkeys";

type ModalTarget =
  | null
  | "item-search"
  | "weight"
  | "change-qty"
  | "inject-price"
  | "discount-amount"
  | "discount-percent";

export default function SaleScreen() {
  const [loading, setLoading] = useState(false);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const { readWeight } = useWeight();
  const {
    addLine,
    carts,
    activeCartIndex,
    setMemberLevel,
    lineOffset,
    setLineOffset,
  } = useSalesStore();

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
    setSelectedLineKey(null);
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

  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  const selectedLine = useMemo(() => {
    if (selectedLineKey == null) return null;
    return lines.find((line) => line.lineKey === selectedLineKey) || null;
  }, [lines, selectedLineKey]);

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

      {/* Inner Layout */}
      <div className="flex-1 flex divide-x divide-gray-200 h-full overflow-hidden">
        {/* Line Viewer */}
        <div className="flex-1 bg-white">
          <SaleScreenLineViewer
            lines={lines}
            lineOffset={lineOffset}
            maxOffset={maxOffset}
            setSelectedLineKey={setSelectedLineKey}
            selectedLineKey={selectedLineKey}
          />
        </div>

        {/* Pagination */}
        <Paging
          lineOffset={lineOffset}
          maxOffset={maxOffset}
          setLineOffset={(offset) => {
            setLineOffset(offset);
            setSelectedLineKey(null);
          }}
        />

        {/* Functions */}
        <div className="w-[600px] h-full flex flex-col divide-y divide-gray-200">
          <div className="flex-1">
            {selectedLine && (
              <LineFunctionPanel
                line={selectedLine}
                onCancel={() => setSelectedLineKey(null)}
                onOpenChangeQty={() => setModalTarget("change-qty")}
                onOpenInjectPrice={() => setModalTarget("inject-price")}
                onOpenDiscountAmount={() => setModalTarget("discount-amount")}
                onOpenDiscountPercent={() => setModalTarget("discount-percent")}
              />
            )}
            {selectedLine == null && <Hotkeys />}
          </div>

          {/* monitor */}
          <div className="h-48"></div>
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

      <ChangeQtyModal
        open={modalTarget === "change-qty"}
        onClose={() => setModalTarget(null)}
        line={selectedLine}
      />

      <InjectPriceModal
        open={modalTarget === "inject-price"}
        onClose={() => setModalTarget(null)}
        line={selectedLine}
      />

      <DiscountAmountModal
        open={modalTarget === "discount-amount"}
        onClose={() => setModalTarget(null)}
        line={selectedLine}
      />

      <DiscountPercentModal
        open={modalTarget === "discount-percent"}
        onClose={() => setModalTarget(null)}
        line={selectedLine}
      />
    </div>
  );
}

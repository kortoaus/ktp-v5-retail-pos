import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchMemberById } from "../../service/crm.service";
import { Item, Member } from "../../types/models";
import { searchItemByBarcode } from "../../service/item.service";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { generateSaleLineItem } from "../../libs/item-utils";
import { SaleLineItem } from "../../types/sales";
import { embededPriceParser } from "../../libs/scan-utils";
import { isPPBarcode, parsePPBarcode, calcMarkdownPrice } from "../../libs/pp-barcode";
import type { AddLineOptions } from "../../store/newSalesStore.helper";
import { useNewSalesStore, LINE_PAGE_SIZE } from "../../store/newSalesStore";
import { MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import { useWeight } from "../../hooks/useWeight";
import { cn } from "../../libs/cn";
import SearchItemModal from "../../components/SearchItemModal";
import LineViewer from "./LineViewer";
import CartSwitcher from "./CartSwitcher";
import LineFunctionPanel from "./LineFunctionPanel";
import ChangeQtyModal from "./ChangeQtyModal";
import InjectPriceModal from "./InjectPriceModal";
import DiscountAmountModal from "./DiscountAmountModal";
import DiscountPercentModal from "./DiscountPercentModal";
import MemberSearchModal from "../../components/MemberSearchModal";
import WeightModal from "../../components/WeightModal";
import useNewPromotions from "../../hooks/useNewPromotions";
import useCartDiscounts from "../../hooks/useCartDiscounts";
import DocumentMonitor from "./DocumentMonitor";
import DiscountListModal from "./DiscountListModal";
import NewPaymentModal from "./NewPaymentModal";
import CloudHotkeyViewer from "../../components/CloudHotkeyViewer";
import useCloudHotkeys from "../../hooks/useCloudHotkeys";
import LinePaging from "./LinePaging";
import PrintLatestInvoiceButton from "../../components/PrintLatestInvoiceButton";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import SyncButton from "../../components/SyncButton";
import SyncPostButton from "../../components/SyncPostButton";

type ModalTarget =
  | null
  | "item-search"
  | "weight"
  | "change-qty"
  | "inject-price"
  | "discount-amount"
  | "discount-percent"
  | "member-search"
  | "payment"
  | "user-voucher"
  | "discount-list";

export default function NewSaleScreen() {
  const navigate = useNavigate();
  const {
    carts,
    activeCartIndex,
    addLine,
    setMember,
    lineOffset,
    setLineOffset,
    clearActiveCart,
  } = useNewSalesStore();
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const pendingWeightLineRef = useRef<SaleLineItem | null>(null);
  const { readWeight } = useWeight();
  const { cloudHotkeys, cloudHotkeysLoading } = useCloudHotkeys();
  useNewPromotions();
  const cartDiscounts = useCartDiscounts();

  const lines = useMemo(
    () => carts[activeCartIndex]?.lines ?? [],
    [carts, activeCartIndex],
  );
  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  const selectedLine = useMemo(
    () =>
      selectedLineKey
        ? lines.find((l) => l.lineKey === selectedLineKey) ?? null
        : null,
    [lines, selectedLineKey],
  );

  const member = useMemo(
    () => carts[activeCartIndex]?.member ?? null,
    [carts, activeCartIndex],
  );

  const scanCallback = useCallback(
    async (rawBarcode: string) => {
      if (loading) return;

      // Search Member
      if (rawBarcode.startsWith("member%%%")) {
        try {
          setLoading(true);
          const memberId = rawBarcode.split("%%%")[1];
          const { ok, msg, result } = await searchMemberById(memberId);
          if (ok && result) {
            setMember({
              id: result.id,
              name: result.name,
              level: result.level,
              phone_last4: result.phone_last4,
            });
          } else {
            window.alert(msg);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }

        return;
      }

      if (isPPBarcode(rawBarcode)) {
        const pp = parsePPBarcode(rawBarcode);
        if (!pp) {
          window.alert("Invalid prepacked barcode");
          return;
        }
        try {
          setLoading(true);
          const { ok, msg, result } = await searchItemByBarcode(pp.barcode);
          if (ok && result) {
            addLinePP(pp, result);
          } else {
            window.alert(msg || "Item not found");
          }
        } catch (e) {
          console.error(e);
          window.alert("Failed to load item");
        } finally {
          setLoading(false);
          setLastScanned(rawBarcode);
        }
        return;
      }

      try {
        setLoading(true);
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

  const handleWeightConfirm = useCallback(
    (weightKg: number) => {
      const data = pendingWeightLineRef.current;
      if (!data) return;
      const qtyInt = Math.round(weightKg * QTY_SCALE);
      addLine(data, { qty: qtyInt, measured_weight: qtyInt });
      pendingWeightLineRef.current = null;
      setModalTarget(null);
    },
    [addLine],
  );

  const handleWeightClose = useCallback(() => {
    pendingWeightLineRef.current = null;
    setModalTarget(null);
  }, []);

  function addLineGateway(item: Item, rawBarcode: string) {
    const data = generateSaleLineItem(item, rawBarcode);

    if (data.type === "invalid") {
      window.alert("Invalid item");
      return;
    }

    if (data.type === "weight") {
      pendingWeightLineRef.current = data;
      setModalTarget("weight");
      return;
    }

    addLine(data);
    setSelectedLineKey(null);
    setModalTarget(null);
  }

  function addLinePP(pp: ReturnType<typeof parsePPBarcode>, item: Item) {
    if (!pp) return;
    const data = generateSaleLineItem(item, item.barcode);
    if (data.type === "invalid") {
      window.alert("Invalid item");
      return;
    }

    data.price = data.price ? { ...data.price, prices: pp.prices } : null;
    data.promoPrice = pp.promoPrices.length > 0
      ? { ...(data.promoPrice ?? { id: 0, companyId: 0, itemId: item.id, name_en: "", name_ko: "", priceType: "promo", prices: [], startDate: "", endDate: "", archived: false, createdAt: "", updatedAt: "" }), prices: pp.promoPrices }
      : null;

    const memberLevel = useNewSalesStore.getState().carts[useNewSalesStore.getState().activeCartIndex]?.member?.level ?? 0;
    const original = pp.prices[0] ?? 0;
    const levelPrice = pp.prices[memberLevel] ?? 0;
    const promoPrice = pp.promoPrices[memberLevel] ?? 0;
    const candidates = [levelPrice, promoPrice].filter((p) => p > 0 && p < original);
    const effectivePrice = candidates.length > 0 ? Math.min(...candidates) : original;

    const options: AddLineOptions = {};

    if (pp.weight != null) {
      data.type = "weight-prepacked";
      options.qty = QTY_SCALE;
      options.measured_weight = pp.weight;
    }

    if (pp.discountType && pp.discountAmount > 0) {
      options.adjustedPrice = calcMarkdownPrice(effectivePrice, pp.discountType, pp.discountAmount);
      options.ppMarkdown = { discountType: pp.discountType, discountAmount: pp.discountAmount };
    }

    addLine(data, Object.keys(options).length > 0 ? options : undefined);
    setSelectedLineKey(null);
    setModalTarget(null);
  }
  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      {/* ── Top Bar ──────────────────────────────────────── */}
      <div className="h-16 flex items-center justify-between gap-4 px-4 border-b border-gray-200">
        <div className="flex items-center gap-4 h-full py-2">
          <TopBarButton label="← Back" onClick={() => navigate("/")} />
          <TopBarButton
            label="Search Item"
            onClick={() => setModalTarget("item-search")}
          />
          <TopBarButton
            label={member ? member.name : "Member"}
            active={member !== null}
            onClick={() => {
              if (member) {
                setMember(null);
              } else {
                setModalTarget("member-search");
              }
            }}
          />
          <TopBarButton
            label="Discounts"
            active={cartDiscounts.length > 0}
            onClick={() => setModalTarget("discount-list")}
          />
          <PrintLatestInvoiceButton className="w-24 h-full rounded-sm text-sm font-bold bg-gray-200 border border-gray-300" />
          <TopBarButton label="Kick Drawer" onClick={() => kickDrawer()} />
        </div>
        <div className="flex items-center gap-4">
          <SyncButton />
          <SyncPostButton />
          <CartSwitcher />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex-1 flex divide-x divide-gray-200 overflow-hidden">
        <div className="flex-1 bg-white">
          <LineViewer
            lines={lines}
            lineOffset={lineOffset}
            selectedLineKey={selectedLineKey}
            setSelectedLineKey={setSelectedLineKey}
          />
        </div>

        <LinePaging
          lineOffset={lineOffset}
          maxOffset={maxOffset}
          setLineOffset={(offset) => {
            setLineOffset(offset);
            setSelectedLineKey(null);
          }}
        />

        {/* Right Panel */}
        <div className="w-[550px] h-full flex flex-col divide-y divide-gray-200">
          {/* Function Area — hotkeys or line actions */}
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
            {!selectedLine &&
              !cloudHotkeysLoading &&
              cloudHotkeys.length > 0 && (
                <CloudHotkeyViewer
                  hotkeys={cloudHotkeys}
                  onItemClick={(barcode: string) => scanCallback(barcode)}
                />
              )}
          </div>

          {/* Document Monitor — subtotal, discount, due */}
          <div className="h-24">
            <DocumentMonitor discounts={cartDiscounts} />
          </div>

          {/* Action Bar — Clear + Pay */}
          <div className="h-20 grid grid-cols-4 gap-2 p-2">
            <div
              className="bg-red-500 text-white font-bold rounded-lg flex items-center justify-center"
              onClick={() => {
                if (window.confirm("Are you sure you want to clear the cart?")) {
                  clearActiveCart();
                  setSelectedLineKey(null);
                }
              }}
            >
              Clear Cart
            </div>
            <div
              className={cn(
                "bg-blue-600 text-white font-bold rounded-lg col-span-3 flex items-center justify-center transition-opacity",
                lines.length === 0 && "opacity-50",
              )}
              onClick={() => {
                if (lines.length === 0) {
                  window.alert("No lines to pay");
                  return;
                }
                setModalTarget("payment");
              }}
            >
              Pay
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────── */}
      {/* SearchItemModal */}
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
        autoPolling={true}
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
      <MemberSearchModal
        open={modalTarget === "member-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(m) => {
          setMember({
            id: m.id,
            name: m.name,
            level: m.level,
            phone_last4: m.phone_last4,
          });
          setModalTarget(null);
        }}
      />
      <DiscountListModal
        open={modalTarget === "discount-list"}
        onClose={() => setModalTarget(null)}
        discounts={cartDiscounts}
      />
      <NewPaymentModal
        open={modalTarget === "payment"}
        onClose={() => setModalTarget(null)}
        lines={lines}
        discounts={cartDiscounts}
        memberId={member?.id ?? null}
        memberLevel={member?.level ?? null}
        onComplete={() => {
          clearActiveCart();
          setSelectedLineKey(null);
          setModalTarget(null);
        }}
      />
    </div>
  );
}

function TopBarButton({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "w-24 h-full rounded-sm text-sm font-bold flex items-center justify-center border border-gray-300",
        active ? "bg-blue-500 text-white" : "bg-gray-200",
      )}
    >
      {label}
    </div>
  );
}



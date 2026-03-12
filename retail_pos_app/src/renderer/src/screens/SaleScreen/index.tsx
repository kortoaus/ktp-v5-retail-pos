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
import Paging from "./LinePaging";
import DocumentMonitor from "./DocumentMonitor";
import MemberSearchModal from "../../components/MemberSearchModal";
import PaymentModal from "../../components/PaymentModal";
import SyncButton from "../../components/SyncButton";
import { useNavigate } from "react-router-dom";
import { useShift } from "../../contexts/ShiftContext";
import BlockScreen from "../../components/BlockScreen";
import CartSwitcher from "./CartSwitcher";
import { cn } from "../../libs/cn";
import { searchMemberById } from "../../service/crm.service";
import useCloudHotkeys from "../../hooks/useCloudHotkeys";
import CloudHotkeyViewer from "../../components/CloudHotkeyViewer";
import LoadingOverlay from "../../components/LoadingOverlay";
import SyncPostButton from "../../components/SyncPostButton";
import { useUser } from "../../contexts/UserContext";
import hasScope from "../../libs/scope-utils";
import DiscountListModal from "./DiscountListModal";

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

export default function SaleScreen() {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useUser();
  const { shift, loading: shiftLoading } = useShift();
  // const { hotkeys, hotkeysLoading } = useHotkeys();
  const { cloudHotkeys, cloudHotkeysLoading } = useCloudHotkeys();
  const [loading, setLoading] = useState(false);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const { readWeight } = useWeight();
  const {
    addLine,
    addDiscount,
    carts,
    activeCartIndex,
    setMember,
    lineOffset,
    setLineOffset,
    clearActiveCart,
    removeDiscount,
  } = useSalesStore();

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
            setMember(result);
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

      // Search Item
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

  const member = useMemo(() => {
    return carts[activeCartIndex].member;
  }, [carts, activeCartIndex]);

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

  const discounts = useMemo(() => {
    return carts[activeCartIndex].discounts;
  }, [carts, activeCartIndex]);

  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  const selectedLine = useMemo(() => {
    if (selectedLineKey == null) return null;
    return lines.find((line) => line.lineKey === selectedLineKey) || null;
  }, [lines, selectedLineKey]);

  // const handleAddDiscount = useCallback(
  //   (discount: SaleStoreDiscount) => {
  //     addDiscount(discount);
  //   },
  //   [addDiscount],
  // );

  if (shiftLoading || userLoading) {
    return <div>loading...</div>;
  }

  if (!user || !hasScope(user.scope, ["sale"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  if (!shift) {
    return <BlockScreen label="Shift is not open" link="/" />;
  }

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      {loading && <LoadingOverlay />}
      <div className="h-16 flex items-center justify-between gap-4 px-4 border-b border-gray-200">
        <div className="flex items-center gap-4 h-full py-2">
          <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center bg-gray-200 border border-gray-300",
            )}
            onClick={() => navigate("/")}
          >
            <div>&larr; Back</div>
          </div>
          <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center bg-gray-200 border border-gray-300",
            )}
            onClick={() => setModalTarget("item-search")}
          >
            <div>Search</div>
            <div>Item</div>
          </div>
          <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center border border-gray-300",
              member === null ? "bg-gray-200" : "bg-blue-500 text-white",
            )}
            onClick={() => {
              if (member === null) {
                setModalTarget("member-search");
              } else {
                setMember(null);
              }
            }}
          >
            {member === null ? (
              <>
                <div>Search</div>
                <div>Member</div>
              </>
            ) : (
              <>
                <div>{member.name}</div>
                <div className="text-sm text-gray-300">
                  {`Level ${member.level}`}
                </div>
              </>
            )}
          </div>
          {/* <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center bg-gray-200 border border-gray-300",
            )}
            onClick={() => setModalTarget("user-voucher")}
          >
            <div>User</div>
            <div>Voucher</div>
          </div> */}
          <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center border border-gray-300",
              discounts.length > 0 ? "bg-green-600 text-white" : "bg-gray-200",
            )}
            onClick={() => setModalTarget("discount-list")}
          >
            <div>Discounts</div>
            <div>{`(${discounts.length})`}</div>
          </div>
          {/* <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center bg-gray-200 border border-gray-300",
            )}
            onClick={() => navigate("/manager/invoices")}
          >
            <div>Invoices</div>
          </div>
          <div
            className={cn(
              "w-24 h-full rounded-sm text-sm font-bold center bg-gray-200 border border-gray-300",
            )}
            onClick={() => navigate("/manager/cashio")}
          >
            <div>Cash I/O</div>
          </div> */}
        </div>

        <div className="flex items-center justify-end gap-4">
          <SyncButton />
          <SyncPostButton />
          <CartSwitcher />
        </div>
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
        <div className="w-[550px] h-full flex flex-col divide-y divide-gray-200">
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

            {!cloudHotkeysLoading &&
              cloudHotkeys.length > 0 &&
              selectedLine == null && (
                <CloudHotkeyViewer
                  hotkeys={cloudHotkeys}
                  onItemClick={(barcode: string) => {
                    scanCallback(barcode);
                  }}
                />
              )}
          </div>

          {/* monitor */}
          <div className="h-24">
            <DocumentMonitor />
          </div>
          <div className="h-20 grid grid-cols-4 gap-2 p-2">
            <div
              className="bg-red-500 text-white font-bold rounded-lg center"
              onClick={() => {
                const ask = window.confirm(
                  "Are you sure you want to clear the cart?",
                );
                if (ask) {
                  clearActiveCart();
                }
              }}
            >
              Clear Cart
            </div>

            <div
              className={cn(
                "bg-blue-600 text-white font-bold rounded-lg col-span-3 center transition-opacity",
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

      <PaymentModal
        open={modalTarget === "payment"}
        onClose={() => setModalTarget(null)}
        lines={lines}
        memberId={member ? member.id : null}
        memberLevel={member?.level ?? null}
        onComplete={() => {
          clearActiveCart();
          setModalTarget(null);
        }}
        discounts={discounts}
      />

      <MemberSearchModal
        open={modalTarget === "member-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(member) => {
          if (member) {
            setMember({
              id: member.id,
              name: member.name,
              level: member.level,
              phone_last4: member.phone_last4,
            });
          }
          setModalTarget(null);
        }}
      />

      {/* <UserVoucherModal
        open={modalTarget === "user-voucher"}
        onClose={() => setModalTarget(null)}
        onSelect={(voucher) => {
          const newDiscount: SaleStoreDiscount = {
            lineKey: null,
            entityType: "voucher",
            entityId: voucher.id,
            description: "User Daily Voucher",
            amount: voucher.left_amount,
          };
          handleAddDiscount(newDiscount);
          setModalTarget(null);
        }}
      /> */}

      <DiscountListModal
        open={modalTarget === "discount-list"}
        onClose={() => setModalTarget(null)}
        discounts={discounts}
        onRemove={removeDiscount}
      />
    </div>
  );
}

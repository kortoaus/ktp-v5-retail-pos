import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchMemberById } from "../../service/crm.service";
import { searchItemByBarcode } from "../../service/item.service";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { SaleLineItem } from "../../types/sales";
import { useOrderLoad } from "../../hooks/useOrderLoad";
import {
  itemLookupAction,
  lineFromItem,
  memberChangeBlockedMessage,
  memberLookupAction,
  ppLookupAction,
  routeScan,
  SCAN_MESSAGES,
  searchPickBarcode,
  weighedLine,
  type ScanAction,
} from "../../libs/sale/scan-dispatch";
import { useSalesStore, LINE_PAGE_SIZE } from "../../store/SalesStore";
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
import DocumentMonitor from "./DocumentMonitor";
import useCloudHotkeys from "../../hooks/useCloudHotkeys";
import LinePaging from "./LinePaging";
import PrintLatestInvoiceButton from "../../components/PrintLatestInvoiceButton";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import SyncButton from "../../components/SyncButton";
import OrdersPendingButton from "../../components/orders/OrdersPendingButton";
import OrderSearchModal from "../../components/orders/OrderSearchModal";
import PaymentModal from "./PaymentModal";
import CloudHotkeyViewerV2 from "../../components/CloudHotkeyViewerV2";

type ModalTarget =
  | null
  | "item-search"
  | "weight"
  | "change-qty"
  | "inject-price"
  | "discount-amount"
  | "discount-percent"
  | "member-search"
  | "order-search"
  | "payment";

export default function SaleScreen() {
  const navigate = useNavigate();
  const {
    carts,
    activeCartIndex,
    addLine,
    setMember,
    lineOffset,
    setLineOffset,
    clearActiveCart,
  } = useSalesStore();
  const [loading, setLoading] = useState(false);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const pendingWeightLineRef = useRef<SaleLineItem | null>(null);
  const { readWeight } = useWeight();
  const { cloudHotkeys, cloudHotkeysLoading } = useCloudHotkeys();
  const { loadOrder } = useOrderLoad();

  const lines = useMemo(
    () => carts[activeCartIndex]?.lines ?? [],
    [carts, activeCartIndex],
  );
  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);

  const selectedLine = useMemo(
    () =>
      selectedLineKey
        ? (lines.find((l) => l.lineKey === selectedLineKey) ?? null)
        : null,
    [lines, selectedLineKey],
  );

  const member = useMemo(
    () => carts[activeCartIndex]?.member ?? null,
    [carts, activeCartIndex],
  );

  // S3 — 주문 로드 카트 배지 표시용.
  const activeOrderNo = useMemo(
    () => carts[activeCartIndex]?.orderNo ?? null,
    [carts, activeCartIndex],
  );

  // S3-b — 이미 주문이 연결된 카트에서는 주문 검색 진입을 막는다.
  const orderLinked = useMemo(
    () => carts[activeCartIndex]?.externalOrderId != null,
    [carts, activeCartIndex],
  );

  // Executes a ScanAction from libs/sale/scan-dispatch (the decision is
  // pure and shared with Runner; the screen only performs it).
  function runScanAction(action: ScanAction) {
    switch (action.kind) {
      case "none":
        return;
      case "alert":
        window.alert(action.message);
        return;
      case "set-member":
        setMember(action.member);
        return;
      case "request-weight":
        pendingWeightLineRef.current = action.line;
        setModalTarget("weight");
        return;
      case "add-line":
        addLine(action.line, action.options);
        setSelectedLineKey(null);
        setModalTarget(null);
        return;
    }
  }

  const scanCallback = useCallback(
    async (rawBarcode: string) => {
      if (loading) return;

      // 우선순위: member%%% → order%%% → PP → 상품 바코드 (routeScan).
      const route = routeScan(rawBarcode);

      switch (route.kind) {
        case "member": {
          // S3 리뷰 — 주문 로드 카트의 멤버는 주문 스냅샷과 한 몸.
          // (getState 직접 조회 — scanCallback 클로저의 carts 스테일 방지)
          const { carts: freshCarts, activeCartIndex: freshIdx } =
            useSalesStore.getState();
          const blocked = memberChangeBlockedMessage(freshCarts[freshIdx]);
          if (blocked) {
            window.alert(blocked);
            return;
          }
          try {
            setLoading(true);
            const res = await searchMemberById(route.qr.memberId);
            runScanAction(memberLookupAction(res, route.qr));
          } catch (e) {
            console.error(e);
          } finally {
            setLoading(false);
          }
          return;
        }

        // S3 — 픽업리스트 QR. 정책·주입은 useOrderLoad 가 전담 (배선만).
        case "order": {
          try {
            setLoading(true);
            await loadOrder(route.orderId);
          } catch (e) {
            console.error(e);
          } finally {
            setLoading(false);
          }
          return;
        }

        case "pp-invalid":
          window.alert(route.message);
          return;

        case "pp": {
          try {
            setLoading(true);
            const res = await searchItemByBarcode(route.pp.barcode);
            const { carts: freshCarts, activeCartIndex: freshIdx } =
              useSalesStore.getState();
            const memberLevel = freshCarts[freshIdx]?.member?.level ?? 0;
            runScanAction(ppLookupAction(res, route.pp, memberLevel));
          } catch (e) {
            console.error(e);
            window.alert(SCAN_MESSAGES.ppLookupFailed);
          } finally {
            setLoading(false);
          }
          return;
        }

        case "item": {
          try {
            setLoading(true);
            const res = await searchItemByBarcode(route.barcode);
            runScanAction(itemLookupAction(res, route.barcode));
          } catch (e) {
            console.error(e);
            window.alert(SCAN_MESSAGES.scanFailed);
          } finally {
            setLoading(false);
          }
          return;
        }
      }
    },
    [loading, runScanAction, loadOrder],
  );

  useBarcodeScanner(scanCallback);

  const handleWeightConfirm = useCallback(
    (weightKg: number) => {
      const data = pendingWeightLineRef.current;
      if (!data) return;
      const { line, options } = weighedLine(data, weightKg);
      addLine(line, options);
      pendingWeightLineRef.current = null;
      setModalTarget(null);
    },
    [addLine],
  );

  const handleWeightClose = useCallback(() => {
    pendingWeightLineRef.current = null;
    setModalTarget(null);
  }, []);

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      {/* ── Top Bar ──────────────────────────────────────── */}
      <div className="h-14 flex items-center justify-between gap-4 px-4 border-b border-gray-200">
        <div className="flex items-center gap-4 h-full py-2">
          <TopBarButton label="← Back" onClick={() => navigate("/")} />
          <TopBarButton
            label="Item"
            onClick={() => setModalTarget("item-search")}
          />
          <TopBarButton
            label={
              member
                ? (member.name ?? `Offline ****${member.id.slice(-4)}`)
                : "Member"
            }
            active={member !== null}
            onClick={() => {
              // S3 리뷰 — 주문 로드 카트에서는 멤버 해제/교체 차단 (스캔
              // 경로와 동일 사유 — 카트 클리어로만 벗어난다).
              const blocked = memberChangeBlockedMessage(
                carts[activeCartIndex],
              );
              if (blocked) {
                window.alert(blocked);
                return;
              }
              if (member) {
                setMember(null);
              } else {
                setModalTarget("member-search");
              }
            }}
          />
          {/* S3-b — 온라인 주문 검색 (QR 을 못 쓰는 손님용 수동 진입).
              이미 주문이 붙은 카트에서는 중복 로드 방지로 비활성. */}
          <TopBarButton
            label="Order"
            disabled={orderLinked}
            onClick={() => setModalTarget("order-search")}
          />

          <PrintLatestInvoiceButton className="w-24 h-full rounded-sm text-sm font-bold bg-gray-200 border border-gray-300" />
          <TopBarButton label="Kick Drw" onClick={() => kickDrawer()} />
          {/* 스케일 스테이션 스위치 — 카트는 전역 스토어라 왕복해도 유지 */}
          <TopBarButton label="Scale" onClick={() => navigate("/scale")} />
          {/* S3 — 주문 로드 카트 배지 (Clear Cart / 결제 완료 시 소멸) */}
          {activeOrderNo && (
            <span className="h-full px-3 rounded-sm text-sm font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center">
              Order #{activeOrderNo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <OrdersPendingButton />
          <SyncButton />
          <CartSwitcher />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex-1 flex divide-x divide-gray-200 overflow-hidden">
        <div className="w-[600px] bg-white flex flex-col">
          <div className="flex-1">
            <LineViewer
              lines={lines}
              lineOffset={lineOffset}
              selectedLineKey={selectedLineKey}
              setSelectedLineKey={setSelectedLineKey}
            />
          </div>

          {/* Document Monitor — subtotal, discount, due */}
          <div className="h-14">
            <DocumentMonitor />
          </div>
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
        <div className="flex-1 h-full flex flex-col divide-y divide-gray-200">
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
            {!cloudHotkeysLoading && cloudHotkeys.length > 0 && (
              <div className={cn(selectedLine ? "hidden" : "w-full h-full")}>
                <CloudHotkeyViewerV2
                  hotkeys={cloudHotkeys}
                  onItemClick={(barcode: string) => scanCallback(barcode)}
                />
              </div>
            )}
          </div>

          {/* Action Bar — Clear + Pay */}
          <div className="h-16 grid grid-cols-4 gap-2 p-2">
            <div
              className="bg-red-500 text-white font-bold rounded-lg flex items-center justify-center"
              onClick={() => {
                if (
                  window.confirm("Are you sure you want to clear the cart?")
                ) {
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
          runScanAction(lineFromItem(item, searchPickBarcode(item)));
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
            points: m.points,
          });
          setModalTarget(null);
        }}
      />
      {/* S3-b — 선택 시 모달만 닫고 로드는 useOrderLoad 가 전담
          (확인 다이얼로그·차단 알럿 포함). */}
      <OrderSearchModal
        open={modalTarget === "order-search"}
        onClose={() => setModalTarget(null)}
        onSelect={(orderId) => {
          void loadOrder(orderId);
        }}
      />
      {modalTarget === "payment" && (
        <PaymentModal
          onCancel={() => {
            setModalTarget(null);
          }}
        />
      )}
    </div>
  );
}

function TopBarButton({
  label,
  onClick,
  active,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        "w-24 h-full rounded-sm text-sm font-bold flex items-center justify-center text-center leading-tight border border-gray-300",
        active ? "bg-blue-500 text-white" : "bg-gray-200",
        disabled && "opacity-40",
      )}
    >
      {label}
    </div>
  );
}

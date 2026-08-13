// OrderViewer — 주문 디테일 + 전이 (슬라이스 B). SaleInvoiceViewer 관례:
// 항상 마운트 + orderId null 이면 render null, 백드롭 onPointerDown 닫기 +
// 내부 stopPropagation, 자체 fetch/loading/error.
//
// UI 원칙(오너 지시): 기능 우선, 장식 최소 — 느슨한 세로 스택 섹션 +
// 기본 구분선/배지/h-14 버튼까지만. 섹션은 파일 단위로 쪼개 교체 쉽게.
// onPointerDown 만 사용(스캐너 Enter 트랩). 1366×768 전제.
//
// 전이: confirm 1회("Customer will be notified." 포함) → 서비스 호출 →
// 성공 시 응답 DTO 로 상세 갱신 + onChanged()(목록 재조회) + PLACED 발이면
// orderInboxStore 카운트 낙관적 -1. 409(TRANSITION_CONFLICT)는 알림 후
// 상세 재조회로 실상태 학습. Reject 사유는 trim 1~200자.

import { useEffect, useState } from "react";
import OnScreenKeyboard from "../OnScreenKeyboard";
import { useUser } from "../../contexts/UserContext";
import { useZplPrinters } from "../../hooks/useZplPrinters";
import { printOrderPickList } from "../../libs/printer/order-pick-list-receipt";
import {
  acceptOrder,
  getOrder,
  revealOrderMemberPhone,
  readyOrder,
  recordOrderPrinted,
  rejectOrder,
  type OrderDetail,
  type OrderLine,
  type OrderPrintedBody,
} from "../../service/order.service";
import { decrementPendingCount } from "./orderInboxStore";
import { buildOrderLabelZpl } from "./order-label-zpl";
import {
  buildLabelPrintedCounts,
  countPicklistPrinted,
} from "./order-print-events";
import type { OrderStatusAction } from "./order-status-policy";
import {
  buildPickListRenderModel,
  formatOrderDueDisplay,
} from "./pick-list-render";
import OrderViewerSummary from "./OrderViewerSummary";
import OrderViewerMadeToOrderSection from "./OrderViewerMadeToOrderSection";
import OrderViewerPickingSection from "./OrderViewerPickingSection";
import OrderViewerTotals from "./OrderViewerTotals";
import OrderViewerActionBar from "./OrderViewerActionBar";

const CONFIRM_TEXTS: Record<OrderStatusAction, (orderNo: string) => string> = {
  ACCEPTED: (orderNo) =>
    `Accept order ${orderNo}? Customer will be notified.`,
  READY: (orderNo) =>
    `Mark order ${orderNo} as ready? Customer will be notified.`,
  REJECTED: (orderNo) =>
    `Reject order ${orderNo}? Customer will be notified.`,
};

interface Props {
  orderId: number | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function OrderViewer({ orderId, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  // 공개된 전화번호는 이 로컬 state 에만 존재 — 뷰어를 닫거나 다른 주문을
  // 열면 즉시 소멸(캐시/스토리지 금지, web client MemberDetail 불변식).
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 공유 in-flight boolean 하나 — 액션 바 전체 disabled (v1 관례).
  const [inFlight, setInFlight] = useState(false);
  // 인쇄 버튼(픽업리스트 + 라인별 라벨) 공유 in-flight — 더블탭 = 2장 방지,
  // 1탭 = 정확히 1장 (슬라이스 C). 전이 in-flight 와는 별개.
  const [printInFlight, setPrintInFlight] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { user } = useUser();
  const { printers, printLabel } = useZplPrinters();

  useEffect(() => {
    if (orderId == null) return;
    setDetail(null);
    setRevealedPhone(null);
    setRevealing(false);
    setError("");
    setRejectOpen(false);
    setRejectReason("");
    setLoading(true);
    getOrder(orderId).then((res) => {
      if (res.ok && res.result) setDetail(res.result);
      else setError(res.msg || "Failed to load order");
      setLoading(false);
    });
  }, [orderId]);

  async function refetchDetail() {
    if (orderId == null) return;
    const res = await getOrder(orderId);
    if (res.ok && res.result) setDetail(res.result);
    else setError(res.msg || "Failed to load order");
  }

  async function runTransition(action: OrderStatusAction, reason?: string) {
    if (!detail || inFlight) return;
    if (!window.confirm(CONFIRM_TEXTS[action](detail.orderNo))) return;
    setInFlight(true);
    try {
      const prevStatus = detail.status;
      const res =
        action === "ACCEPTED"
          ? await acceptOrder(detail.id, detail.version)
          : action === "READY"
            ? await readyOrder(detail.id, detail.version)
            : await rejectOrder(detail.id, detail.version, reason ?? "");
      if (res.ok && res.result) {
        setDetail(res.result);
        setRejectOpen(false);
        setRejectReason("");
        onChanged();
        // PLACED 발 전이 성공 → 미접수 카운트 낙관적 -1 (차임 갭 제거).
        // 다음 브로드캐스터 틱이 정본으로 덮는다.
        if (prevStatus === "PLACED") decrementPendingCount();
      } else if (res.status === 409 || res.msg === "TRANSITION_CONFLICT") {
        window.alert("Order was updated elsewhere — refreshing.");
        setRejectOpen(false);
        setRejectReason("");
        await refetchDetail();
      } else {
        window.alert(res.msg || "Failed to update order");
      }
    } finally {
      setInFlight(false);
    }
  }

  function handleAction(action: OrderStatusAction) {
    if (action === "REJECTED") {
      setRejectOpen(true);
      return;
    }
    void runTransition(action);
  }

  function submitReject() {
    const reason = rejectReason.trim();
    if (reason.length < 1 || reason.length > 200) {
      window.alert("Reject reason must be 1-200 characters.");
      return;
    }
    void runTransition("REJECTED", reason);
  }

  // --- 슬라이스 C: 실물 인쇄 2종 ---
  // 인쇄 성공 → printed 기록 POST(best-effort) → 응답 상세로 갱신(카운트
  // 리프레시). 기록 실패는 console.error only — 인쇄를 막지 않는다(스펙).
  async function recordPrinted(orderId: number, body: OrderPrintedBody) {
    try {
      const res = await recordOrderPrinted(orderId, body);
      if (res.ok && res.result) setDetail(res.result);
      else console.error("[order-printed] record failed:", res.msg);
    } catch (err) {
      console.error("[order-printed] record failed:", err);
    }
  }

  async function handlePrintPickList() {
    if (!detail || printInFlight) return;
    setPrintInFlight(true);
    try {
      // 기존 ESC/POS raster 파이프라인 — printESCPOS 가 프린터 미설정/실패를
      // 자체 알럿으로 처리하고 throw 하지 않는다(기존 인쇄 관례).
      await printOrderPickList(buildPickListRenderModel(detail));
      await recordPrinted(detail.id, { kind: "picklist" });
    } catch (err) {
      console.error("[order-pick-list] print failed:", err);
    } finally {
      setPrintInFlight(false);
    }
  }

  async function handlePrintLabel(line: OrderLine) {
    if (!detail || printInFlight) return;
    // 제작 라벨은 ZPL 100×100 전용 — media 100100 ZPL 프린터가 설정에
    // 없으면 알럿 후 중단(스펙).
    const printer = printers.find(
      (p) => p.mediaSize === "100100" && p.language === "zpl",
    );
    if (!printer) {
      window.alert("No 100x100 ZPL label printer configured.");
      return;
    }
    setPrintInFlight(true);
    try {
      const zpl = buildOrderLabelZpl(
        {
          orderNo: detail.orderNo,
          dueDisplay: formatOrderDueDisplay(detail.dueAt),
        },
        line,
      );
      const result = await printLabel(printer, { language: "zpl", data: zpl });
      if (!result.ok) {
        console.error("[order-label] print failed:", result.message);
        return;
      }
      await recordPrinted(detail.id, { kind: "label", lineId: line.id });
    } catch (err) {
      console.error("[order-label] print failed:", err);
    } finally {
      setPrintInFlight(false);
    }
  }

  const handleRevealPhone = async () => {
    if (orderId == null || revealing) return;
    setRevealing(true);
    try {
      const res = await revealOrderMemberPhone(orderId);
      if (res.ok && res.result) {
        setRevealedPhone(res.result.phone);
      } else {
        window.alert(res.msg || "Failed to reveal phone number");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRevealing(false);
    }
  };

  if (orderId == null) return null;

  const madeToOrderLines = detail
    ? detail.lines.filter((line) => line.options.length > 0)
    : [];
  const pickingLines = detail
    ? detail.lines.filter((line) => line.options.length === 0)
    : [];
  // 인쇄 카운트 — 상세 events 에서 파생 (crm 이 정본, 로컬 상태 없음).
  const picklistCount = detail ? countPicklistPrinted(detail.events) : 0;
  const labelCounts = detail
    ? buildLabelPrintedCounts(detail.events)
    : new Map<number, number>();

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
        style={{ zIndex: 1500 }}
        onPointerDown={onClose}
      >
        <div
          className="bg-white rounded-lg w-full max-w-5xl max-h-[92vh] overflow-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 헤더 — 타이틀 + 닫기 (주문번호/상태 배지는 요약 섹션) */}
          <div className="sticky top-0 bg-white border-b border-gray-300 flex items-center justify-between px-4 h-12 z-10">
            <h2 className="font-bold">Order</h2>
            <button
              type="button"
              onPointerDown={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
            >
              ✕
            </button>
          </div>

          {loading && (
            <div className="p-10 text-center text-gray-400">Loading...</div>
          )}
          {error && !loading && (
            <div className="p-10 text-center text-red-500">{error}</div>
          )}

          {detail && (
            <>
              <OrderViewerSummary
                detail={detail}
                revealedPhone={revealedPhone}
                revealing={revealing}
                onRevealPhone={handleRevealPhone}
                onHidePhone={() => setRevealedPhone(null)}
              />
              {/* 픽업리스트 인쇄 — 전이 버튼과 구분되는 secondary 스타일,
                  요약 섹션 직하 배치(장식 최소). 카운트는 PICKLIST_PRINTED. */}
              <div className="px-4 py-3 border-b border-gray-300">
                <button
                  type="button"
                  disabled={printInFlight}
                  onPointerDown={() => void handlePrintPickList()}
                  className="w-full h-12 rounded-lg bg-gray-200 font-bold active:bg-gray-300 disabled:opacity-40"
                >
                  {`Print pick list${picklistCount > 0 ? ` (${picklistCount})` : ""}`}
                </button>
              </div>
              <OrderViewerMadeToOrderSection
                lines={madeToOrderLines}
                labelCounts={labelCounts}
                printInFlight={printInFlight}
                onPrintLabel={(line) => void handlePrintLabel(line)}
              />
              <OrderViewerPickingSection lines={pickingLines} />
              <OrderViewerTotals detail={detail} />
              {/* ⑤ 거절 사유 — 있을 때만 */}
              {detail.rejectReason && (
                <div className="p-4 border-b border-gray-300">
                  <div className="font-bold mb-1">Reject Reason</div>
                  <div className="text-red-600">{detail.rejectReason}</div>
                </div>
              )}
              <OrderViewerActionBar
                status={detail.status}
                userScopes={user?.scope ?? []}
                inFlight={inFlight}
                onAction={handleAction}
              />
            </>
          )}
        </div>
      </div>

      {/* Reject 사유 모달 — 백드롭의 형제 렌더 (PaymentModalForRepay 관례:
          viewer backdrop 의 onPointerDown 버블링이 모달을 관통해 닫는 것을
          방지). OnScreenKeyboard 직접 내장 — KeyboardInputText 의 자체
          오버레이(zIndex 1000)는 viewer(1500) 아래에 깔리므로 못 쓴다. */}
      {rejectOpen && detail && (
        <div
          className="fixed inset-0 bg-black/50 flex flex-col items-center justify-end p-4"
          style={{ zIndex: 1600 }}
          onPointerDown={() => setRejectOpen(false)}
        >
          <div
            className="bg-white rounded-lg w-full max-w-3xl p-4"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="font-bold mb-2">
              Reject order {detail.orderNo} — reason (required, sent to
              customer)
            </div>
            <div className="min-h-[44px] border border-gray-300 rounded-lg px-3 py-2 text-lg mb-1">
              {rejectReason || (
                <span className="text-gray-400">Type a reason...</span>
              )}
            </div>
            <div className="text-right text-sm text-gray-400 mb-2">
              {rejectReason.trim().length}/200
            </div>
            <OnScreenKeyboard
              value={rejectReason}
              onChange={setRejectReason}
              onEnter={submitReject}
            />
            <div className="flex gap-3 mt-3">
              <button
                type="button"
                onPointerDown={() => setRejectOpen(false)}
                className="flex-1 h-14 rounded-lg bg-gray-200 text-lg font-bold active:bg-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inFlight}
                onPointerDown={submitReject}
                className="flex-1 h-14 rounded-lg bg-red-600 text-white text-lg font-bold disabled:opacity-40"
              >
                {inFlight ? "..." : "Reject Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

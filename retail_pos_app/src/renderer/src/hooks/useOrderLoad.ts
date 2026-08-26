// S3 — C&C 주문을 활성 카트로 로드 (specs/2026-08-21-pos-order-load-collect-design.md §1).
// 조립 원칙: SaleScreen/OrderViewer 는 배선만, 정책·주입 로직은 전부 여기.
//
// 상태별 정책은 order-load-policy.ts 에서 순수하게 결정한다. 로드는 CRM에
// 어떤 쓰기도 하지 않으며, 결제 완료 시에만 서버가 COLLECTED 로 전이한다.
//
// 로드 동작 (§X-8 관례): 빈 카트 필수 → 멤버 먼저 부착(멤버 QR 스캔 경로와
// 같은 CRM 조회 — 실패 시에만 §Y 미검증 최소 멤버 폴백 + 안내) → 라인 주입
// (unit_price_adjusted = 주문 라인 unitPrice — 스냅샷 가격이 로컬 카탈로그를
// 이긴다, qty = 정책 수량 × QTY_SCALE). 로컬에 없는 아이템이 하나라도 있으면
// 전체 중단 (부분 로드 금지 — 금액 정합). 성공 시 카트에 externalOrderId +
// orderNo 마킹 (같은 주문 중복 로드 금지).

import { useCallback, useState } from "react";
import { QTY_SCALE } from "../libs/constants";
import { generateSaleLineItem } from "../libs/item-utils";
import { searchMemberById } from "../service/crm.service";
import { searchItemById } from "../service/item.service";
import {
  getOrder,
  type OrderDetail,
  type OrderLine,
} from "../service/order.service";
import { useSalesStore } from "../store/SalesStore";
import type { SaleLineItem } from "../types/sales";
import { getOrderLoadPolicy, type OrderLoadQtySource } from "./order-load-policy";

/**
 * 멤버 조회 실패 시 안내 (오너 결정 2026-08-26). 로드는 성공하되, 이 카트의
 * 멤버는 미검증 최소 멤버라 결제단에서 포인트·바우처가 뜨지 않는다.
 * 러너(ktpv5-retail-runner/src/hooks/useOrderLoad.ts)와 문구 동일.
 */
export const MEMBER_UNAVAILABLE_MESSAGE =
  "Member details unavailable — points and vouchers won't show for this sale.";

// 로드 수량 결정 (순수). null = 이 라인은 제외.
function chosenQtyOf(line: OrderLine, qtySource: OrderLoadQtySource): number {
  if (qtySource === "picked") return line.pickedQty ?? 0;
  return line.qty;
}

interface PreparedLine {
  data: SaleLineItem;
  qty: number; // EA 정수 (×QTY_SCALE 전)
  unitPrice: number; // cents — 옵션 포함 실효단가 (주문 스냅샷)
}

export function useOrderLoad() {
  const [orderLoading, setOrderLoading] = useState(false);

  const loadOrder = useCallback(async (orderId: number): Promise<boolean> => {
    if (orderLoading) return false;
    setOrderLoading(true);
    try {
      const res = await getOrder(orderId);
      if (!res.ok || !res.result) {
        window.alert(res.msg || "Failed to load order");
        return false;
      }
      const detail: OrderDetail = res.result;

      // ── 상태·결제·이행 방식 정책 ──
      const policy = getOrderLoadPolicy({
        status: detail.status,
        paymentStatus: detail.paymentStatus,
        fulfillment: detail.fulfillment,
        pickedQtys: detail.lines.map((line) => line.pickedQty),
      });
      if (policy.mode === "block") {
        window.alert(policy.message);
        return false;
      }
      if (policy.mode === "confirm" && !window.confirm(policy.message)) {
        return false;
      }

      // ── 카트 가드 ──
      const { carts, activeCartIndex, setMember, addLine, setCartOrder } =
        useSalesStore.getState();
      const externalOrderId = String(detail.id);
      const holdingIdx = carts.findIndex(
        (c) => c.externalOrderId === externalOrderId,
      );
      if (holdingIdx !== -1) {
        window.alert(
          `Order ${detail.orderNo} is already loaded in Cart ${holdingIdx + 1}.`,
        );
        return false;
      }
      const activeCart = carts[activeCartIndex];
      if (activeCart.lines.length > 0 || activeCart.member != null) {
        window.alert(
          "Active cart is not empty — switch to an empty cart to load an order.",
        );
        return false;
      }

      // ── 로드 대상 라인 ──
      const loadable = detail.lines
        .slice()
        .sort((a, b) => a.sort - b.sort)
        .map((line) => ({ line, qty: chosenQtyOf(line, policy.qtySource) }))
        .filter(({ qty }) => qty > 0);
      if (loadable.length === 0) {
        // READY 인데 기록된 수량이 전부 0 — 피킹 결과 "집은 게 없음" (S3 리뷰).
        window.alert(
          policy.qtySource === "picked"
            ? "Nothing was picked for this order."
            : "No quantities to load for this order.",
        );
        return false;
      }

      // ── 로컬 아이템 선조회 — 하나라도 없으면 카트를 건드리기 전에 중단
      //    (부분 로드 금지, 롤백 불요) ──
      const prepared: PreparedLine[] = [];
      for (const { line, qty } of loadable) {
        const itemRes = await searchItemById(line.sourceItemId);
        if (!itemRes.ok || !itemRes.result) {
          window.alert(
            `Item not found locally: ${line.name_en}. Load aborted — run cloud sync first.`,
          );
          return false;
        }
        const item = itemRes.result;
        const data = generateSaleLineItem(
          item,
          item.barcodeGTIN || item.barcodePLU || item.barcode,
        );
        if (data.type === "invalid") {
          window.alert(
            `Item has no local price: ${line.name_en}. Load aborted.`,
          );
          return false;
        }
        prepared.push({
          // S3 리뷰 — GST 플래그도 가격처럼 주문 라인 스냅샷이 로컬 카탈로그
          // 를 이긴다 (와이어에 taxable 실림 — 스냅샷 정합 원칙).
          data: { ...data, taxable: line.taxable },
          qty,
          unitPrice: line.unitPrice,
        });
      }

      // ── 멤버 먼저 부착 — 멤버 QR 스캔 경로와 **같은 조회·같은 매핑** ──
      //    (오너 결정 2026-08-26) 결제단 바우처/포인트는 실제 level·points 가
      //    붙어 있어야 뜬다. 그래서 주문의 memberId 로 CRM 을 한 번 조회해
      //    SaleScreen 의 member%%% 브랜치와 동일한 필드로 부착한다.
      //    조회 실패(네트워크 단절 / 미조회) 시에만 기존 §Y 미검증 최소
      //    멤버로 폴백하고 안내한다 — 로드 자체는 계속 성공해야 한다.
      let memberVerified = false;
      try {
        const memberRes = await searchMemberById(detail.memberId);
        if (memberRes.ok && memberRes.result) {
          const m = memberRes.result;
          setMember({
            id: m.id,
            name: m.name,
            level: m.level,
            phone_last4: m.phone_last4,
            points: m.points,
          });
          memberVerified = true;
        }
      } catch (e) {
        console.error("[order-load] member lookup failed:", e);
      }
      if (!memberVerified) {
        // §Y hold 스타일 미검증 최소 멤버 — 적립은 업싱크가 CRM 검증 후 처리.
        setMember({
          id: detail.memberId,
          name: detail.memberName,
          level: 1,
          phone_last4: null,
          points: null,
          unverified: true,
        });
      }

      // ── 라인 주입 — 주문 스냅샷 단가를 adjusted 로 (로컬 카탈로그보다
      //    우선). 라인명에 주문 태그 (PP 마크다운 태그 관례). ──
      for (const { data, qty, unitPrice } of prepared) {
        addLine(
          { ...data, name_en: `${data.name_en} [Order #${detail.orderNo}]` },
          { qty: qty * QTY_SCALE, adjustedPrice: unitPrice },
        );
      }

      setCartOrder(externalOrderId, detail.orderNo);
      // 안내는 로드 완료 후 — window.alert 은 블로킹이라 라인 주입 전에
      // 띄우면 "로드가 멈춘 것"처럼 보인다. 로드는 이미 성공했다.
      if (!memberVerified) window.alert(MEMBER_UNAVAILABLE_MESSAGE);
      return true;
    } catch (e) {
      console.error("[order-load] failed:", e);
      window.alert("Failed to load order");
      return false;
    } finally {
      setOrderLoading(false);
    }
  }, [orderLoading]);

  return { loadOrder, orderLoading };
}

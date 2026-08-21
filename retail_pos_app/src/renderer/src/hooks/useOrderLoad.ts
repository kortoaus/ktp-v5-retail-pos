// S3 — C&C 주문을 활성 카트로 로드 (specs/2026-08-21-pos-order-load-collect-design.md §1).
// 조립 원칙: SaleScreen/OrderViewer 는 배선만, 정책·주입 로직은 전부 여기.
//
// 상태별 정책 (오너 2026-08-21):
//   READY    — 즉시 로드, 수량 = pickedQty (0/미기록 라인 제외).
//   ACCEPTED — 컨펌 후 로드, 수량 = 주문 qty (캐셔가 카트에서 조정).
//   PLACED   — 차단 ("접수 먼저").
//   종결     — 차단 (COLLECTED 는 "이미 결제 완료" — 중복 결제 1차 방어).
//
// 로드 동작 (§X-8 관례): 빈 카트 필수 → 멤버 먼저 부착(§Y hold 스타일 미검증
// 최소 멤버 — 적립은 업싱크가 CRM 검증 후 처리) → 라인 주입
// (unit_price_adjusted = 주문 라인 unitPrice — 스냅샷 가격이 로컬 카탈로그를
// 이긴다, qty = 정책 수량 × QTY_SCALE). 로컬에 없는 아이템이 하나라도 있으면
// 전체 중단 (부분 로드 금지 — 금액 정합). 성공 시 카트에 externalOrderId +
// orderNo 마킹 (같은 주문 중복 로드 금지).

import { useCallback, useState } from "react";
import { QTY_SCALE } from "../libs/constants";
import { generateSaleLineItem } from "../libs/item-utils";
import { searchItemById } from "../service/item.service";
import {
  getOrder,
  type OrderDetail,
  type OrderLine,
} from "../service/order.service";
import { useSalesStore } from "../store/SalesStore";
import type { SaleLineItem } from "../types/sales";

// 로드 수량 결정 (순수). null = 이 라인은 제외.
function chosenQtyOf(line: OrderLine, status: "ACCEPTED" | "READY"): number {
  if (status === "READY") return line.pickedQty ?? 0;
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

      // ── 상태 정책 ──
      if (detail.status === "PLACED") {
        window.alert("Order not accepted yet — accept it first.");
        return false;
      }
      if (detail.status === "COLLECTED") {
        window.alert("This order is already paid & collected.");
        return false;
      }
      if (detail.status !== "ACCEPTED" && detail.status !== "READY") {
        window.alert(
          `Order ${detail.orderNo} is ${detail.status} — cannot load.`,
        );
        return false;
      }
      // 가드 통과 시점의 내로잉을 const 로 고정 (클로저 내 사용).
      const loadStatus: "ACCEPTED" | "READY" = detail.status;
      if (loadStatus === "ACCEPTED") {
        const ok = window.confirm(
          "This order hasn't been picked yet. Load with ordered quantities?\n(아직 피킹 확정 전 주문입니다. 주문 수량으로 불러올까요?)",
        );
        if (!ok) return false;
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
        .map((line) => ({ line, qty: chosenQtyOf(line, loadStatus) }))
        .filter(({ qty }) => qty > 0);
      if (loadable.length === 0) {
        window.alert("No quantities to load for this order.");
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
        prepared.push({ data, qty, unitPrice: line.unitPrice });
      }

      // ── 멤버 먼저 부착 (§Y hold 스타일 미검증 최소 멤버) ──
      setMember({
        id: detail.memberId,
        name: detail.memberName,
        level: 1,
        phone_last4: null,
        points: null,
        unverified: true,
      });

      // ── 라인 주입 — 주문 스냅샷 단가를 adjusted 로 (로컬 카탈로그보다
      //    우선). 라인명에 주문 태그 (PP 마크다운 태그 관례). ──
      for (const { data, qty, unitPrice } of prepared) {
        addLine(
          { ...data, name_en: `${data.name_en} [Order #${detail.orderNo}]` },
          { qty: qty * QTY_SCALE, adjustedPrice: unitPrice },
        );
      }

      setCartOrder(externalOrderId, detail.orderNo);
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

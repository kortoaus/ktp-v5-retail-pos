import { create } from "zustand";

import { SaleLineItem } from "../types/sales";
import { QTY_SCALE } from "../libs/constants";
import { removeLineFromCart } from "./cart-line-remove";
import {
  type AddLineOptions,
  type Cart,
  type SaleMember,
  buildNewLine,
  createEmptyCart,
  findMergeTarget,
  recalculateCartLines,
  recalculateLine,
  reindexLines,
} from "./SalesStore.helper";

const CART_COUNT = 4;
export const LINE_PAGE_SIZE = 10;
export const ALLOWED_CHANGE_QTY_TYPES = [
  "normal",
  "prepacked",
  // "weight-prepacked",
];
interface SalesStoreState {
  activeCartIndex: number;
  carts: Cart[];
  lineOffset: number;
  addLine: (item: SaleLineItem, options?: AddLineOptions) => void;
  removeLine: (lineKey: string) => void;
  changeLineQty: (lineKey: string, qty: number) => void;
  injectLinePrice: (lineKey: string, price: number | null) => void;
  setMember: (member: SaleMember | null) => void;
  // S3 — 활성 카트에 주문 마킹 (로드 훅 전용). null/null 로 해제.
  setCartOrder: (externalOrderId: string | null, orderNo: string | null) => void;
  setLineOffset: (offset: number) => void;
  switchCart: (index: number) => void;
  clearActiveCart: () => void;
  cartCount: number;
}

export const useSalesStore = create<SalesStoreState>()((set, get) => ({
  activeCartIndex: 0,
  carts: Array.from({ length: CART_COUNT }, createEmptyCart),
  lineOffset: 0,
  cartCount: CART_COUNT,
  addLine: (item, options) => {
    if (item.type === "invalid") return;

    const { activeCartIndex, carts } = get();
    const member = carts[activeCartIndex].member;
    const memberLevel = member?.level ?? 0;
    const cart = carts[activeCartIndex];
    let lines = [...cart.lines];

    if (item.type === "normal") {
      const mergeIdx = findMergeTarget(lines, item, memberLevel, options);
      if (mergeIdx !== -1) {
        const merged = recalculateLine({
          ...lines[mergeIdx],
          qty: lines[mergeIdx].qty + QTY_SCALE,
        });
        lines.splice(mergeIdx, 1);
        lines.push(merged);
        const reindexed = reindexLines(lines);
        const updatedCarts = [...carts];
        updatedCarts[activeCartIndex] = { ...cart, lines: reindexed };
        set({
          carts: updatedCarts,
          lineOffset: Math.max(0, reindexed.length - LINE_PAGE_SIZE),
        });
        return;
      }
    }

    const newLine = buildNewLine(item, memberLevel, lines.length, options);
    lines.push(newLine);

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = { ...cart, lines };
    set({
      carts: updatedCarts,
      lineOffset: Math.max(0, lines.length - LINE_PAGE_SIZE),
    });
  },

  removeLine: (lineKey) => {
    const { activeCartIndex, carts } = get();
    // S3 리뷰 — 순수 리듀서로 위임: 마지막 라인 제거로 카트가 비면 주문
    // 마킹도 해제된다 (로드 포기 의미론 — cart-line-remove.ts 참조).
    const next = removeLineFromCart(carts[activeCartIndex], lineKey);
    if (next === null) return;

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = next;
    set({ carts: updatedCarts });
  },

  changeLineQty: (lineKey, qty) => {
    const { activeCartIndex, carts } = get();
    const cart = carts[activeCartIndex];
    const idx = cart.lines.findIndex((l) => l.lineKey === lineKey);
    if (idx === -1) return;

    const line = cart.lines[idx];

    if (!ALLOWED_CHANGE_QTY_TYPES.includes(line.type)) return;

    if (qty <= 0) {
      get().removeLine(lineKey);
      return;
    }

    const updated = recalculateLine({ ...line, qty });
    const lines = [...cart.lines];
    lines[idx] = updated;

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = {
      ...cart,
      lines: reindexLines(lines),
    };
    set({ carts: updatedCarts });
  },

  injectLinePrice: (lineKey, price) => {
    const { activeCartIndex, carts } = get();
    const cart = carts[activeCartIndex];
    const idx = cart.lines.findIndex((l) => l.lineKey === lineKey);
    if (idx === -1) return;

    const line = cart.lines[idx];

    const updated = recalculateLine({
      ...line,
      unit_price_adjusted: price,
      adjustments:
        price !== null
          ? [...line.adjustments, "PRICE_OVERRIDE"]
          : line.adjustments.filter((adj) => adj !== "PRICE_OVERRIDE"),
    });

    const lines = [...cart.lines];
    lines[idx] = updated;

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = { ...cart, lines };
    set({ carts: updatedCarts });
  },

  setMember: (member) => {
    const { carts, activeCartIndex } = get();
    const level = member?.level ?? 0;
    const updatedCart = recalculateCartLines(
      { ...carts[activeCartIndex], member },
      level,
    );
    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = updatedCart;
    set({ carts: updatedCarts });
  },

  setCartOrder: (externalOrderId, orderNo) => {
    const { carts, activeCartIndex } = get();
    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = {
      ...carts[activeCartIndex],
      externalOrderId,
      orderNo,
    };
    set({ carts: updatedCarts });
  },

  setLineOffset: (offset) => set({ lineOffset: offset }),

  switchCart: (index) => {
    if (index >= 0 && index < CART_COUNT) {
      const { carts } = get();
      const lines = carts[index].lines;
      set({
        activeCartIndex: index,
        lineOffset: Math.max(0, lines.length - LINE_PAGE_SIZE),
      });
    }
  },

  clearActiveCart: () => {
    const { activeCartIndex, carts } = get();
    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = createEmptyCart();
    set({ carts: updatedCarts });
  },
}));

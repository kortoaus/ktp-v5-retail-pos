import { create } from "zustand";
import { SaleLineItem, SaleStoreDiscount } from "../types/sales";
import { Promotion } from "../types/models";
import {
  type AddLineOptions,
  type Cart,
  type SaleMember,
  applyPromotions,
  buildNewLine,
  createEmptyCart,
  findMergeTarget,
  recalculateAllLines,
  recalculateLine,
  reindexLines,
} from "./salesStore.helpers";

const CART_COUNT = 4;
export const LINE_PAGE_SIZE = 10;
export const ALLOWED_CHANGE_QTY_TYPES = [
  "normal",
  "prepacked",
  // "weight-prepacked",
];

export type { AddLineOptions, SaleMember };

interface SalesState {
  activeCartIndex: number;
  carts: Cart[];
  lineOffset: number;
  promotions: Promotion[];
  addLine: (item: SaleLineItem, options?: AddLineOptions) => void;
  removeLine: (lineKey: string) => void;
  changeLineQty: (lineKey: string, qty: number) => void;
  injectLinePrice: (lineKey: string, price: number | null) => void;
  setMember: (member: SaleMember | null) => void;
  setPromotions: (promotions: Promotion[]) => void;
  setLineOffset: (offset: number) => void;
  switchCart: (index: number) => void;
  clearActiveCart: () => void;
  removeDiscount: (
    entityType: SaleStoreDiscount["entityType"],
    entityId: number,
  ) => void;
  cartCount: number;
}

export const useSalesStore = create<SalesState>()((set, get) => ({
  activeCartIndex: 0,
  carts: Array.from({ length: CART_COUNT }, createEmptyCart),
  lineOffset: 0,
  promotions: [],
  cartCount: CART_COUNT,
  addLine: (item, options) => {
    if (item.type === "invalid") return;

    const { activeCartIndex, carts } = get();
    const member = carts[activeCartIndex].member;
    const memberLevel = member?.level ?? 0;
    const cart = carts[activeCartIndex];
    let lines = [...cart.lines];

    if (item.type === "normal") {
      const mergeIdx = findMergeTarget(lines, item, memberLevel);
      if (mergeIdx !== -1) {
        const merged = recalculateLine({
          ...lines[mergeIdx],
          qty: lines[mergeIdx].qty + 1,
        });
        lines.splice(mergeIdx, 1);
        lines.push(merged);
        const reindexed = reindexLines(lines);
        const updatedCarts = [...carts];
        updatedCarts[activeCartIndex] = {
          lines: reindexed,
          member,
          discounts: applyPromotions(reindexed, get().promotions),
        };
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
    updatedCarts[activeCartIndex] = {
      lines,
      member,
      discounts: applyPromotions(lines, get().promotions),
    };
    set({
      carts: updatedCarts,
      lineOffset: Math.max(0, lines.length - LINE_PAGE_SIZE),
    });
  },

  removeLine: (lineKey) => {
    const { activeCartIndex, carts } = get();
    const cart = carts[activeCartIndex];
    const filtered = cart.lines.filter((l) => l.lineKey !== lineKey);
    if (filtered.length === cart.lines.length) return;

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = {
      lines: reindexLines(filtered),
      member: cart.member,
      discounts: applyPromotions(filtered, get().promotions),
    };
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
      lines: reindexLines(lines),
      member: cart.member,
      discounts: applyPromotions(lines, get().promotions),
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
    updatedCarts[activeCartIndex] = {
      lines,
      member: cart.member,
      discounts: applyPromotions(lines, get().promotions),
    };
    set({ carts: updatedCarts });
  },

  setMember: (member) => {
    const { carts, activeCartIndex, promotions } = get();
    const level = member?.level ?? 0;
    const cart = carts[activeCartIndex];
    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = { ...cart, member };
    const recalculated = recalculateAllLines(updatedCarts, level);
    recalculated[activeCartIndex] = {
      ...recalculated[activeCartIndex],
      discounts: applyPromotions(
        recalculated[activeCartIndex].lines,
        promotions,
      ),
    };
    set({ carts: recalculated });
  },

  setPromotions: (promotions) => {
    const { carts, activeCartIndex } = get();
    const cart = carts[activeCartIndex];
    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = {
      ...cart,
      discounts: applyPromotions(cart.lines, promotions),
    };
    set({ promotions, carts: updatedCarts });
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

  removeDiscount: (entityType, entityId) => {
    const { activeCartIndex, carts } = get();
    const cart = carts[activeCartIndex];
    const filtered = cart.discounts.filter(
      (d) => !(d.entityType === entityType && d.entityId === entityId),
    );
    if (filtered.length === cart.discounts.length) return;

    const updatedCarts = [...carts];
    updatedCarts[activeCartIndex] = {
      ...cart,
      discounts: filtered,
    };
    set({ carts: updatedCarts });
  },
}));

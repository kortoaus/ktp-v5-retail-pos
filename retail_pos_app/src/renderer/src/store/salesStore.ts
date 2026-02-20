import { create } from "zustand";
import { SaleLineItem, SaleLineType } from "../types/sales";
import { Decimal } from "decimal.js";
import { MONEY_DP, QTY_DP } from "../libs/constants";
import { useShallow } from "zustand/shallow";

interface Cart {
  lines: SaleLineType[];
}

const CART_COUNT = 4;
export const LINE_PAGE_SIZE = 10;
export const ALLOWED_CHANGE_QTY_TYPES = [
  "normal",
  "prepacked",
  // "weight-prepacked",
];

function createEmptyCart(): Cart {
  return { lines: [] };
}

function resolveOriginalPrice(item: SaleLineItem): number {
  return item.price?.prices[0] ?? 0;
}

function resolveDiscountedPrice(
  item: SaleLineItem,
  memberLevel: number,
): number | null {
  const original = item.price?.prices[0] ?? 0;
  const levelPrice = item.price?.prices[memberLevel] ?? 0;
  const promoPrice = item.promoPrice?.prices[memberLevel] ?? 0;

  const candidates = [levelPrice, promoPrice].filter(
    (p) => p > 0 && p < original,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function recalculateLine(line: SaleLineType): SaleLineType {
  const unit_price_effective =
    line.unit_price_adjusted ??
    line.unit_price_discounted ??
    line.unit_price_original;
  const total = new Decimal(unit_price_effective)
    .mul(line.qty)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
  const tax_amount = line.taxable
    ? new Decimal(total).div(11).toDecimalPlaces(MONEY_DP).toNumber()
    : 0;
  const subtotal = new Decimal(total)
    .sub(tax_amount)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
  return { ...line, unit_price_effective, total, tax_amount, subtotal };
}

function reindexLines(lines: SaleLineType[]): SaleLineType[] {
  return lines.map((line, i) =>
    line.index === i ? line : { ...line, index: i },
  );
}

export interface AddLineOptions {
  prepackedPrice?: number;
  qty?: number;
  measured_weight?: number;
}

function buildNewLine(
  item: SaleLineItem,
  memberLevel: number,
  index: number,
  options?: AddLineOptions,
): SaleLineType {
  const prepackedPrice = options?.prepackedPrice;
  const isPrepacked =
    item.type === "prepacked" || item.type === "weight-prepacked";
  const defaultPrice = item.price?.prices[0] ?? 0;
  const isSupplierPrepacked = isPrepacked && defaultPrice <= 0;

  let unit_price_original: number;
  let unit_price_discounted: number | null;
  let qty: number;

  if (isPrepacked && prepackedPrice != null) {
    if (isSupplierPrepacked) {
      unit_price_original = prepackedPrice;
      unit_price_discounted = null;
      qty = 1;
    } else {
      unit_price_original = defaultPrice;
      unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
      console.log(item.type, prepackedPrice, defaultPrice);
      qty = new Decimal(prepackedPrice)
        .div(defaultPrice)
        .toDecimalPlaces(QTY_DP)
        .toNumber();
    }
  } else {
    unit_price_original = resolveOriginalPrice(item);
    unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
    qty = options?.qty ?? 1;
  }

  let name_en = item.name_en;
  if (item.type === "weight-prepacked") {
    name_en = `${name_en} (Prepacked)`;
  }

  const line: SaleLineType = {
    ...item,
    name_en,
    lineKey: crypto.randomUUID(),
    index,
    original_receipt_id: null,
    original_receipt_line_id: null,
    barcode_price:
      isPrepacked && prepackedPrice != null ? prepackedPrice : null,
    unit_price_adjusted: null,
    unit_price_discounted,
    unit_price_original,
    unit_price_effective: 0,
    qty,
    measured_weight: options?.measured_weight ?? null,
    total: 0,
    tax_amount: 0,
    subtotal: 0,
    adjustments: [],
  };

  return recalculateLine(line);
}

function findMergeTarget(
  lines: SaleLineType[],
  item: SaleLineItem,
  memberLevel: number,
): number {
  const unit_price_original = resolveOriginalPrice(item);
  const unit_price_discounted = resolveDiscountedPrice(item, memberLevel);

  return lines.findIndex(
    (l) =>
      l.type === "normal" &&
      l.itemId === item.itemId &&
      l.unit_price_adjusted === null &&
      l.unit_price_discounted === unit_price_discounted &&
      l.unit_price_original === unit_price_original,
  );
}

function recalculateAllLines(carts: Cart[], memberLevel: number): Cart[] {
  return carts.map((cart) => ({
    lines: cart.lines.map((line) => {
      const isPrepacked =
        line.type === "prepacked" || line.type === "weight-prepacked";
      const defaultPrice = line.price?.prices[0] ?? 0;

      if (isPrepacked && line.barcode_price != null && defaultPrice <= 0) {
        return line;
      }

      const unit_price_discounted = resolveDiscountedPrice(line, memberLevel);
      return recalculateLine({ ...line, unit_price_discounted });
    }),
  }));
}

export interface SaleMember {
  id: string;
  name: string;
  level: number;
  phone_last4: string | null;
}

interface SalesState {
  activeCartIndex: number;
  carts: Cart[];
  member: SaleMember | null;
  lineOffset: number;

  addLine: (item: SaleLineItem, options?: AddLineOptions) => void;
  removeLine: (lineKey: string) => void;
  changeLineQty: (lineKey: string, qty: number) => void;
  injectLinePrice: (lineKey: string, price: number | null) => void;
  setMember: (member: SaleMember | null) => void;
  setLineOffset: (offset: number) => void;
  switchCart: (index: number) => void;
  clearActiveCart: () => void;
}

export const useSalesStore = create<SalesState>()((set, get) => ({
  activeCartIndex: 0,
  carts: Array.from({ length: CART_COUNT }, createEmptyCart),
  member: null,
  lineOffset: 0,

  addLine: (item, options) => {
    if (item.type === "invalid") return;

    const { activeCartIndex, carts, member } = get();
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
        updatedCarts[activeCartIndex] = { lines: reindexed };
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
    updatedCarts[activeCartIndex] = { lines };
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
    updatedCarts[activeCartIndex] = { lines: reindexLines(filtered) };
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
    updatedCarts[activeCartIndex] = { lines: reindexLines(lines) };
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
    updatedCarts[activeCartIndex] = { lines };
    set({ carts: updatedCarts });
  },

  setMember: (member) => {
    const { carts } = get();
    const level = member?.level ?? 0;
    set({
      member,
      carts: recalculateAllLines(carts, level),
    });
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
    set({ carts: updatedCarts, member: null });
  },
}));

export const useCartTotals = () => {
  return useSalesStore(
    useShallow((s) => {
      const cart = s.carts[s.activeCartIndex];
      const lines = cart.lines ?? [];

      const itemCount = [...new Set(lines.map((l) => l.itemId))].length;
      const lineCount = lines.length;
      const qtyCount = lines.reduce((acc, l) => {
        if (l.type === "weight" || l.type === "weight-prepacked") {
          return acc + 1;
        }
        return acc + l.qty;
      }, 0);

      const total = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.total));
      }, new Decimal(0));
      const tax_amount = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.tax_amount));
      }, new Decimal(0));
      const subtotal = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.subtotal));
      }, new Decimal(0));

      return {
        itemCount,
        lineCount,
        qtyCount,
        total: total.toNumber(),
        tax_amount: tax_amount.toNumber(),
        subtotal: subtotal.toNumber(),
      };
    }),
  );
};

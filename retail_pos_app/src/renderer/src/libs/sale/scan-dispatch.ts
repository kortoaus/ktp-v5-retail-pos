// Scan dispatch — barcode / QR / item → what the Sale Screen should do
// (retail-runner T-1, D-2). Pure: no DOM, no React, no service calls. The
// screen performs the lookups (member, item) and executes the returned
// ScanAction; Runner copies this file verbatim (sync-sale-core) and executes
// the same actions from its RN screen.
//
// Priority (unchanged from the inline SaleScreen code): member%%% QR →
// order%%% QR → PP `00:` QR → item barcode. Cloud hotkeys and the item search
// pick enter through the same item path (`searchPickBarcode` for the latter).
//
// The only behaviour change from the inline code is F-2: a prepacked /
// weight-prepacked item takes an embedded price only when the raw barcode is a
// price-embedded EAN-13 (`isEmbeddedPriceBarcode`); otherwise it sells at its
// catalog price.

import type { Item } from "../../types/models";
import type { SaleLineItem } from "../../types/sales";
import {
  resolveDiscountedPrice,
  type AddLineOptions,
  type Cart,
  type SaleMember,
} from "../../store/SalesStore.helper";
import { generateSaleLineItem } from "../item-utils";
import { parseMemberQr, type ParsedMemberQr } from "../member-qr";
import { parseOrderQr } from "../order-qr";
import {
  calcMarkdownPrice,
  isPPBarcode,
  parseEmbeddedPriceCents,
  parsePPBarcode,
  type PPBarcode,
} from "../pp-barcode";
import { MONEY_DP, MONEY_SCALE, PCT_SCALE, QTY_SCALE } from "../constants";

// ── Messages (screen text, unchanged) ──────────────────────────
export const SCAN_MESSAGES = {
  invalidPrepacked: "Invalid prepacked barcode",
  invalidItem: "Invalid item",
  itemNotFound: "Item not found",
  ppLookupFailed: "Failed to load item",
  scanFailed: "Failed to scan barcode",
  memberQrNeedsUpdate: "Member QR needs the latest app — try again online",
  memberOtherCompany: "This member card belongs to another store",
} as const;

// ── Route: which lookup the raw scan needs ─────────────────────
export type ScanRoute =
  | { kind: "member"; qr: ParsedMemberQr }
  | { kind: "order"; orderId: number }
  | { kind: "pp"; pp: PPBarcode }
  | { kind: "pp-invalid"; message: string }
  | { kind: "item"; barcode: string };

export function routeScan(rawBarcode: string): ScanRoute {
  const memberQr = parseMemberQr(rawBarcode);
  if (memberQr) return { kind: "member", qr: memberQr };

  const orderQr = parseOrderQr(rawBarcode);
  if (orderQr) return { kind: "order", orderId: orderQr.orderId };

  if (isPPBarcode(rawBarcode)) {
    const pp = parsePPBarcode(rawBarcode);
    if (!pp) return { kind: "pp-invalid", message: SCAN_MESSAGES.invalidPrepacked };
    return { kind: "pp", pp };
  }

  return { kind: "item", barcode: rawBarcode };
}

// ── Action: what the screen executes ───────────────────────────
//   add-line       → store.addLine(line, options), clear line selection, close modal
//   request-weight → open the scale WeightModal for `line`; on confirm use weighedLine
//   set-member     → store.setMember(member)
//   alert          → show message
//   none           → nothing (lookup ok but no item: silent, as before)
export type ScanAction =
  | { kind: "none" }
  | { kind: "alert"; message: string }
  | { kind: "set-member"; member: SaleMember }
  | { kind: "request-weight"; line: SaleLineItem }
  | { kind: "add-line"; line: SaleLineItem; options?: AddLineOptions };

// Lookup answers, structurally (the service's ApiResponse satisfies these).
export interface LookupAnswer<T> {
  ok: boolean;
  msg: string;
  status?: number;
  result?: T | null;
}

export interface MemberLookupResult {
  id: string;
  name: string | null;
  level: number;
  phone_last4: string | null;
  points: number | null;
}

// ── Member ─────────────────────────────────────────────────────
// A cart loaded from an online order keeps that order's member: replacing it
// would send the points / trace to another member. Clear the cart to change.
// Used by the member QR scan and the Member top-bar button alike.
export function memberChangeBlockedMessage(
  cart: Pick<Cart, "externalOrderId" | "orderNo"> | null | undefined,
): string | null {
  if (!cart?.externalOrderId) return null;
  return `This cart is linked to order #${cart.orderNo ?? cart.externalOrderId} — clear the cart to change member.`;
}

// Member QR lookup answer → action. Offline (F-20, D-27) = the till cannot
// reach the store server (status 0) or the store server cannot reach CRM
// (HTTP 503 from /api/crm/member/search/id with `transport`). Offline, the
// QR's id/level are attached unverified — only when the QR's company id is
// the store's company (`Company.cloudId`); CRM verifies the member at upsync
// before awarding points. Any other failure is a plain alert.
export function isMemberLookupOffline(status: number | undefined): boolean {
  return status === 0 || status === 503;
}

export function memberLookupAction(
  res: LookupAnswer<MemberLookupResult>,
  qr: ParsedMemberQr,
  storeCompanyId: number | null | undefined,
): ScanAction {
  if (res.ok && res.result) {
    const m = res.result;
    return {
      kind: "set-member",
      member: {
        id: m.id,
        name: m.name,
        level: m.level,
        phone_last4: m.phone_last4,
        points: m.points,
      },
    };
  }
  if (isMemberLookupOffline(res.status)) {
    if (qr.companyId == null) {
      return { kind: "alert", message: SCAN_MESSAGES.memberQrNeedsUpdate };
    }
    if (storeCompanyId == null || qr.companyId !== storeCompanyId) {
      return { kind: "alert", message: SCAN_MESSAGES.memberOtherCompany };
    }
    return {
      kind: "set-member",
      member: {
        id: qr.memberId,
        name: null,
        level: qr.level ?? 1,
        phone_last4: null,
        points: null,
        unverified: true,
      },
    };
  }
  return { kind: "alert", message: res.msg };
}

// ── Item barcode ───────────────────────────────────────────────
// Item search pick → the barcode the scan path would have seen.
export function searchPickBarcode(
  item: Pick<Item, "barcode" | "barcodeGTIN" | "barcodePLU">,
): string {
  return item.barcodeGTIN || item.barcodePLU || item.barcode;
}

// Barcode lookup answer → action. ok with no item stays silent (as before).
export function itemLookupAction(
  res: LookupAnswer<Item>,
  rawBarcode: string,
): ScanAction {
  if (!res.ok) return { kind: "alert", message: res.msg };
  if (!res.result) return { kind: "none" };
  return lineFromItem(res.result, rawBarcode);
}

// Item + the barcode that reached it → line (was SaleScreen addLineGateway).
export function lineFromItem(item: Item, rawBarcode: string): ScanAction {
  const data = generateSaleLineItem(item, rawBarcode);

  if (data.type === "invalid") {
    return { kind: "alert", message: SCAN_MESSAGES.invalidItem };
  }

  if (data.type === "weight") {
    return { kind: "request-weight", line: data };
  }

  // 7-digit "02xxxxx" PLU of a fixed-weight item: one each at its own price.
  if (rawBarcode.startsWith("02") && rawBarcode.length === 7) {
    if (data.type === "prepacked") {
      return { kind: "add-line", line: { ...data, uom: "ea" } };
    }
  }

  if (data.type === "weight-prepacked" || data.type === "prepacked") {
    // F-2 — only a price-embedded EAN-13 carries a price. Any other barcode
    // of a fixed-weight item (plain GTIN, search pick) sells at the catalog
    // price as an ordinary line.
    const prepackedPriceCents = parseEmbeddedPriceCents(rawBarcode);
    if (prepackedPriceCents === null) {
      return { kind: "add-line", line: data };
    }
    return {
      kind: "add-line",
      line: {
        ...data,
        uom: "ea",
        price: data.price
          ? { ...data.price, prices: [prepackedPriceCents] }
          : null,
      },
      options: {
        qty: QTY_SCALE,
        adjustedPrice: prepackedPriceCents,
      },
    };
  }

  return { kind: "add-line", line: data };
}

// Open-weight item: the WeightModal's reading (kg) → the line to add.
export function weighedLine(
  line: SaleLineItem,
  weightKg: number,
): { line: SaleLineItem; options: AddLineOptions } {
  const qtyInt = Math.round(weightKg * QTY_SCALE);
  return { line, options: { qty: qtyInt, measured_weight: qtyInt } };
}

// ── PP (`00:` QR) ──────────────────────────────────────────────
export function ppLookupAction(
  res: LookupAnswer<Item>,
  pp: PPBarcode,
  memberLevel: number,
  now: Date = new Date(),
): ScanAction {
  if (res.ok && res.result) return lineFromPP(pp, res.result, memberLevel, now);
  return { kind: "alert", message: res.msg || SCAN_MESSAGES.itemNotFound };
}

// PP payload + its item → line (was SaleScreen addLinePP). The label's own
// prices replace the catalog ones; a markdown is baked into adjustedPrice on
// top of the member-level price and kept as ppMarkdown for re-pricing.
export function lineFromPP(
  pp: PPBarcode,
  item: Item,
  memberLevel: number,
  now: Date = new Date(),
): ScanAction {
  const data = generateSaleLineItem(item, item.barcode);
  if (data.type === "invalid") {
    return { kind: "alert", message: SCAN_MESSAGES.invalidItem };
  }

  data.price = data.price ? { ...data.price, prices: pp.prices } : null;
  data.promoPrice =
    pp.promoPrices.length > 0
      ? {
          ...(data.promoPrice ?? {
            id: 0,
            companyId: 0,
            itemId: item.id,
            name_en: "",
            name_ko: "",
            priceType: "promo",
            prices: [],
            validFrom: now.toISOString(),
            validTo: now.toISOString(),
            archived: false,
            createdAt: "",
            updatedAt: "",
          }),
          prices: pp.promoPrices,
        }
      : null;

  const original = pp.prices[0] ?? 0;
  const discountedPrice = resolveDiscountedPrice(data, memberLevel);
  const effectivePrice = discountedPrice ?? original;

  const options: AddLineOptions = {};

  if (pp.discountType && pp.discountAmount > 0) {
    // pct markdown is ×PCT_SCALE of 100% (250 = 25%); amt is cents.
    const tag =
      pp.discountType === "pct"
        ? `[${pp.discountAmount / (PCT_SCALE / 100)}% OFF]`
        : `[$${(pp.discountAmount / MONEY_SCALE).toFixed(MONEY_DP)} OFF]`;
    data.name_en = `${tag} ${data.name_en}`;
  }

  if (pp.weight != null) {
    data.type = "weight-prepacked";
    options.qty = pp.weight;
    options.measured_weight = pp.weight;
    if (pp.discountType === "pct" && pp.discountAmount > 0) {
      options.adjustedPrice = calcMarkdownPrice(
        effectivePrice,
        "pct",
        pp.discountAmount,
      );
      options.ppMarkdown = {
        discountType: "pct",
        discountAmount: pp.discountAmount,
      };
    }
  } else if (pp.discountType && pp.discountAmount > 0) {
    options.adjustedPrice = calcMarkdownPrice(
      effectivePrice,
      pp.discountType,
      pp.discountAmount,
    );
    options.ppMarkdown = {
      discountType: pp.discountType,
      discountAmount: pp.discountAmount,
    };
  }

  return {
    kind: "add-line",
    line: data,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}
